import express from 'express';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { TaskScheduler } from './TaskScheduler';
import { setupDashboard } from './DashboardSetup';

// Load environment variables
dotenv.config();

// Create Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize TaskScheduler
const taskScheduler = new TaskScheduler(
    path.join(__dirname, '..', 'data', 'example_task_config.json')
);

// Setup dashboard routes and API endpoints
async function initializeServer() {
    try {
        // Setup dashboard with all API routes
        await setupDashboard(app, taskScheduler);

     

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        


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

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
            taskScheduler.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
            taskScheduler.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to initialize server:', error);
        process.exit(1);
    }
}

// Initialize and start the server
initializeServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});

export default app;
