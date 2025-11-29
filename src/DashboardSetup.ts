import { Request, Response, Application } from 'express';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { TaskScheduler } from './TaskScheduler';

// Helper function to find the correct web directory path
function getWebDirectoryPath(): string {
    // Try different possible locations for the web directory
    const possiblePaths = [
        // When running from source (ts-node): src/ -> ../web
        path.join(__dirname, '..', 'web'),
        // When running from compiled dist: dist/src/ -> ../../web  
        path.join(__dirname, '..', '..', 'web'),
        // When used as node_module: find the scheduledtasks package root
        path.join(__dirname, '..', '..', 'web'),
    ];
    
    // Also try to find the package root by looking for package.json
    let currentDir = __dirname;
    for (let i = 0; i < 5; i++) { // Max 5 levels up
        const packageJsonPath = path.join(currentDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (packageJson.name === 'scheduledtasks') {
                    // Found our package root, web should be here
                    possiblePaths.unshift(path.join(currentDir, 'web'));
                    break;
                }
            } catch (e) {
                // Ignore JSON parse errors
            }
        }
        currentDir = path.join(currentDir, '..');
    }
    
    // Try to find the web directory
    for (const webPath of possiblePaths) {
        if (fs.existsSync(webPath) && fs.existsSync(path.join(webPath, 'index.html'))) {
            return webPath;
        }
    }
    
    // Fallback - assume relative to current directory
    const fallbackPath = path.join(__dirname, '..', 'web');
    console.warn(`⚠️  Could not find web directory, using fallback: ${fallbackPath}`);
    return fallbackPath;
}

export async function setupDashboard(app: Application, taskScheduler: TaskScheduler, route: string = '/task-scheduler'): Promise<void> {
    console.log('🛣️  Setting up TaskScheduler dashboard routes...');
    
    // Get the correct web directory path
    const webDir =  getWebDirectoryPath();
    console.log(`📁 Using web directory: ${webDir}`);

    // Dashboard API routes
    console.log(`📋 Registering route: GET ${route}/api/status`);
    app.get(`${route}/api/status`, (req, res) => {
        try {
            const status = taskScheduler.getStatus();
            res.json(status);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get status' });
        }
    });

    console.log(`📊 Registering route: GET ${route}/api/task-summary`);
    app.get(`${route}/api/task-summary`, (req, res) => {
        try {
            const summary = taskScheduler.getTaskSummary();
            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get task summary' });
        }
    });

    console.log(`❌ Registering route: GET ${route}/api/errors`);
    app.get(`${route}/api/errors`, (req, res) => {
        try {
            const hours = parseInt(req.query.hours as string) || 24;
            const errors = taskScheduler.getErrorTasks(hours);
            res.json(errors);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get error tasks' });
        }
    });

    // Manual task execution
    console.log(`🚀 Registering route: POST ${route}/api/run-group/:groupName`);
    app.post(`${route}/api/run-group/:groupName`, async (req, res) => {
        try {
            const { groupName } = req.params;
            // Trigger async execution without waiting
            taskScheduler.runTaskGroupNow(groupName).catch(error => {
                console.error(`Background task group execution failed for ${groupName}:`, error);
            });
            res.json({ success: true, message: `Task group ${groupName} triggered successfully` });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: message });
        }
    });

    // Manual single task execution
    console.log(`⚡ Registering route: POST ${route}/api/run-task/:groupName/:taskName`);
    app.post(`${route}/api/run-task/:groupName/:taskName`, async (req, res) => {
        try {
            const { groupName, taskName } = req.params;
            // Trigger async execution without waiting
            taskScheduler.runSingleTaskNow(groupName, taskName).catch(error => {
                console.error(`Background single task execution failed for ${groupName}/${taskName}:`, error);
            });
            res.json({ success: true, message: `Task ${taskName} from group ${groupName} triggered successfully` });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: message });
        }
    });

    // Cleanup endpoint
    console.log(`🧹 Registering route: POST ${route}/api/cleanup`);
    app.post(`${route}/api/cleanup`, (req, res) => {
        try {
            const days = parseInt(req.body.days) || 30;
            taskScheduler.cleanup(days);
            res.json({ success: true, message: `Cleanup completed for ${days} days` });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: message });
        }
    });

    // Dashboard pages
    console.log(`🏠 Registering route: GET ${route} (Dashboard)`);
    app.get(route, (req: Request, res: Response) => {
        const indexPath = path.join(webDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(404).json({ error: 'Dashboard page not found', path: indexPath });
        }
    });

    console.log(`🔴 Registering route: GET ${route}/errors (Errors page)`);
    app.get(`${route}/errors`, (req: Request, res: Response) => {
        const errorsPath = path.join(webDir, 'errors.html');
        if (fs.existsSync(errorsPath)) {
            res.sendFile(errorsPath);
        } else {
            res.status(404).json({ error: 'Errors page not found', path: errorsPath });
        }
    });

    // Serve static files from web directory
    app.use(`${route}/`, express.static(path.join(webDir )));

    console.log('✅ Dashboard setup complete! Registered 8 routes total');
}