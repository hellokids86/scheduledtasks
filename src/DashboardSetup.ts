import { Request, Response, Application } from 'express';
import * as path from 'path';
import { TaskScheduler } from './TaskScheduler';

export async function setupDashboard(app: Application, taskScheduler: TaskScheduler): Promise<void> {
    console.log('🛣️  Setting up TaskScheduler dashboard routes...');

    // Dashboard API routes
    console.log('📋 Registering route: GET /task-scheduler/api/status');
    app.get('/task-scheduler/api/status', (req, res) => {
        try {
            const status = taskScheduler.getStatus();
            res.json(status);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get status' });
        }
    });

    console.log('📊 Registering route: GET /task-scheduler/api/task-summary');
    app.get('/task-scheduler/api/task-summary', (req, res) => {
        try {
            const summary = taskScheduler.getTaskSummary();
            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get task summary' });
        }
    });

    console.log('❌ Registering route: GET /task-scheduler/api/errors');
    app.get('/task-scheduler/api/errors', (req, res) => {
        try {
            const hours = parseInt(req.query.hours as string) || 24;
            const errors = taskScheduler.getErrorTasks(hours);
            res.json(errors);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get error tasks' });
        }
    });

    // Manual task execution
    console.log('🚀 Registering route: POST /task-scheduler/api/run-group/:groupName');
    app.post('/task-scheduler/api/run-group/:groupName', async (req, res) => {
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
    console.log('⚡ Registering route: POST /task-scheduler/api/run-task/:groupName/:taskName');
    app.post('/task-scheduler/api/run-task/:groupName/:taskName', async (req, res) => {
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
    console.log('🧹 Registering route: POST /task-scheduler/api/cleanup');
    app.post('/task-scheduler/api/cleanup', (req, res) => {
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
    console.log('🏠 Registering route: GET /task-scheduler (Dashboard)');
    app.get('/task-scheduler', (req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
    });

    console.log('🔴 Registering route: GET /task-scheduler/errors (Errors page)');
    app.get('/task-scheduler/errors', (req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '..', 'web', 'errors.html'));
    });

    console.log('✅ Dashboard setup complete! Registered 8 routes total');
}