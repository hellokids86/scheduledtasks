// Main exports for the scheduledtasks npm module
export { TaskScheduler } from './src/TaskScheduler';
export { MonitoredScheduledTask, TaskStatus, TaskProgress } from './src/MonitoredScheduledTask';
export { DatabaseManager } from './src/DatabaseManager';
export { setupDashboard } from './src/DashboardSetup';
export { convertUtcToArizonaTime } from './src/dateTimeConvertor';

// Export types for configuration
export interface TaskConfig {
    name: string;
    filePath: string;
    params: Record<string, any>;
    warningHours: number;
    errorHours: number;
}

export interface TaskGroupConfig {
    groupName: string;
    cron: string;
    warningHours: number;
    errorHours: number;
    tasks: TaskConfig[];
}

// Re-export the server functions for convenience
export { createServer, initializeServer } from './src/server';