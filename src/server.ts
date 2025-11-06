import express from 'express';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { TaskScheduler } from './TaskScheduler';
import { setupDashboard } from './DashboardSetup';
import fs from 'fs';
// Load environment variables
dotenv.config();

export function createServer(configPath?: string, port?: number): { app: express.Application; taskScheduler: TaskScheduler } {
    // Create Express application
    const app = express();
    
    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Initialize TaskScheduler
    const taskScheduler = new TaskScheduler(
        configPath || path.join(__dirname, '..', 'data', 'example_task_config.json'), 
        path.join(__dirname, '..', 'data', 'task_database.sqlite')
    );

    return { app, taskScheduler };
}

export async function initializeServer(configPath?: string, port?: number): Promise<{ app: express.Application; taskScheduler: TaskScheduler }> {
    const PORT = port || parseInt(process.env.PORT || '3000');
    const { app, taskScheduler } = createServer(configPath, PORT);

    try {
        // Setup dashboard with all API routes
        await setupDashboard(app, taskScheduler);

        // Root redirect to dashboard
        app.get('/', (req, res) => {
            res.redirect('/task-scheduler');
        });

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });



       

        // Serve static files from web directory (after specific routes)
        app.use(express.static(path.join(__dirname, '..', 'web')));

        // 404 handler
        app.use('*', (req, res) => {
            res.status(404).json({ error: 'Route not found' });
        });

        // Error handler
        app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
            console.error('Server error:', err);
            res.status(500).json({ error: 'Internal server error' });
        });

        // Start the server
        app.listen(PORT, () => {
            console.log(`🚀 Server is running on http://localhost:${PORT}`);
            console.log(`📊 Dashboard available at http://localhost:${PORT}/task-scheduler`);
            console.log(`❌ Errors page available at http://localhost:${PORT}/task-scheduler/errors`);
            console.log(`🔍 Health check available at http://localhost:${PORT}/health`);
        });

        // Start the task scheduler
        taskScheduler.start();
        console.log('✅ Task scheduler started');

        // Setup graceful shutdown handlers
        const shutdownHandler = () => {
            console.log('\n🛑 Received shutdown signal. Shutting down gracefully...');
            taskScheduler.stop();
            process.exit(0);
        };

        process.on('SIGINT', shutdownHandler);
        process.on('SIGTERM', shutdownHandler);

        return { app, taskScheduler };

    } catch (error) {
        console.error('❌ Failed to initialize server:', error);
        process.exit(1);
    }
}

// Main function - only runs when this file is executed directly
async function main(): Promise<void> {
    try {
        console.log('🎯 TaskScheduler application starting...');
        await initializeServer();
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Only execute main when run directly (not when imported as a module)
if (require.main === module) {
    main();
}

// Export the app for testing and module usage
export default createServer;
