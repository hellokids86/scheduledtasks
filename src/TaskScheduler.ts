import * as cron from 'node-cron';
import { DatabaseManager, TaskGroupRecord, TaskRecord } from './DatabaseManager';
import { MonitoredScheduledTask, TaskStatus } from './MonitoredScheduledTask';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Cron } from 'croner';
import { convertUtcToArizonaTime } from './dateTimeConvertor';
import { Request, Response, Application } from 'express';

// Simple UUID generator function
function generateUUID(): string {
    return crypto.randomUUID();
}

export interface TaskConfig {
    name: string;
    filePath: string;
    params: Record<string, any>;
    warningHours: number;
    errorHours: number;
    killOnFail?: boolean;
}

export interface TaskGroupConfig {
    groupName: string;
    cron: string;
    tasks: TaskConfig[];
}

interface ScheduledTask {
    task: cron.ScheduledTask;
    config: TaskGroupConfig;
}

export class TaskScheduler {
    private db: DatabaseManager;
    private scheduledTasks: Map<string, ScheduledTask> = new Map();
    private runningTasks: Map<string, MonitoredScheduledTask> = new Map();
    private updateInterval: NodeJS.Timeout | null = null;
    private isRunning = false;
    private taskConfigs: TaskGroupConfig[] = [];

    constructor(config: string | TaskGroupConfig[] = [], dbPath: string) {
        this.db = DatabaseManager.getInstance(dbPath);
        this.loadConfiguration(config);
    }

    private async loadConfiguration(config: string | TaskGroupConfig[]): Promise<void> {
        try {
            if(typeof config === 'string') {
                const configData = await fs.readFile(config, 'utf-8');
                this.taskConfigs = JSON.parse(configData);
            }else{
                // Directly use provided configuration object
                this.taskConfigs = config;
            }

            for (const groupConfig of this.taskConfigs) {
                this.scheduleTaskGroup(groupConfig);
            }

            this.db.markIncompleteTasksAsErrors();


            console.log(`✅ Loaded ${this.taskConfigs.length} task groups from configuration`);
        } catch (error) {
            console.error('❌ Failed to load task configuration:', error);
            throw error;
        }
    }

    private scheduleTaskGroup(groupConfig: TaskGroupConfig): void {
        const task = cron.schedule(groupConfig.cron, () => {
            if (this.isRunning)
                this.executeTaskGroup(groupConfig);
        }, {
            timezone: "America/Phoenix" // Arizona timezone (no daylight saving)
        });

        this.scheduledTasks.set(groupConfig.groupName, {
            task,
            config: groupConfig
        });

        console.log(`📅 Scheduled task group: ${groupConfig.groupName} with cron: ${groupConfig.cron}`);
    }

    public start(): void {
        if (this.isRunning) {
            console.log('⚠️ TaskScheduler is already running');
            return;
        }

        console.log('🚀 Starting TaskScheduler...');

        // Mark any incomplete tasks/groups from previous sessions as errors
        this.db.markIncompleteTasksAsErrors();

        // Start all scheduled tasks
        this.scheduledTasks.forEach((scheduledTask, groupName) => {
            scheduledTask.task.start();
            console.log(`▶️ Started scheduling for: ${groupName}`);
        });

        // Start the database update interval (every 3 seconds)
        this.startUpdateInterval();

        // Set up graceful shutdown handlers
        this.setupShutdownHandlers();

        this.isRunning = true;
        console.log('✅ TaskScheduler started successfully');
    }

    public stop(): void {
        if (!this.isRunning) {
            console.log('⚠️ TaskScheduler is not running');
            return;
        }

        console.log('🛑 Stopping TaskScheduler...');

        // Mark any in-progress tasks/groups as shutdown errors
        this.db.markRunningTasksAsShutdownErrors();

        // Stop all scheduled tasks
        this.scheduledTasks.forEach((scheduledTask, groupName) => {
            scheduledTask.task.stop();
            console.log(`⏹️ Stopped scheduling for: ${groupName}`);
        });

        // Stop the update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        this.isRunning = false;
        console.log('✅ TaskScheduler stopped successfully');
    }

    private setupShutdownHandlers(): void {
        // Handle graceful shutdown
        const shutdownHandler = () => {
            console.log('\n🔄 Received shutdown signal. Performing graceful shutdown...');
            this.stop();
            process.exit(0);
        };

        // Handle various shutdown signals
        process.on('SIGINT', shutdownHandler);    // Ctrl+C
        process.on('SIGTERM', shutdownHandler);   // Termination signal
        process.on('SIGBREAK', shutdownHandler);  // Windows Ctrl+Break

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught Exception:', error);
            this.db.markInProgressTasksAsShutdown();
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            this.db.markInProgressTasksAsShutdown();
            process.exit(1);
        });
    }

    private async executeTaskGroup(groupConfig: TaskGroupConfig): Promise<void> {
        const taskGroupId = generateUUID();
        const startTime = new Date();

        console.log(`🎯 Starting task group: ${groupConfig.groupName} (ID: ${taskGroupId})`);

        // Check if group is already running
        if (this.db.isTaskGroupRunning(groupConfig.groupName)) {
            console.log(`⏭️ Skipping task group ${groupConfig.groupName} - already running`);
            this.db.insertTaskGroup({
                taskGroupId,
                groupName: groupConfig.groupName,
                status: TaskStatus.SKIPPED,
                message: 'Task group already running',
                startTime: startTime.toISOString()
            });
            return;
        }

        // Create task group record
        this.db.insertTaskGroup({
            taskGroupId,
            groupName: groupConfig.groupName,
            status: TaskStatus.IN_PROGRESS,
            message: 'Task group started',
            startTime: startTime.toISOString()
        });

        try {
            // Create all tasks for this group
            const tasks: MonitoredScheduledTask[] = [];
            const taskInfos: { task: MonitoredScheduledTask; config: TaskConfig; calculatedParams: Record<string, any> }[] = [];

            for (const taskConfig of groupConfig.tasks) {
                const taskId = generateUUID();
                const { task, calculatedParams } = await this.createTask(taskConfig, taskId, taskGroupId);
                tasks.push(task);
                taskInfos.push({ task, config: taskConfig, calculatedParams });
            }

            // Insert task records with calculated parameters
            for (const { task, config, calculatedParams } of taskInfos) {
                this.db.insertTask({
                    taskGroupId,
                    taskId: task.taskId,
                    taskName: config.name,
                    params: JSON.stringify(calculatedParams),
                    filePath: config.filePath,
                    status: TaskStatus.CREATED,
                    message: 'Task created'
                });
            }

            // Execute tasks sequentially, checking for killOnFail
            let shouldContinue = true;
            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                const taskConfig = groupConfig.tasks[i];

                if (!shouldContinue) {
                    // Skip remaining tasks
                    console.log(`⏭️ Skipping task ${task.taskName} due to previous task failure with killOnFail=true`);
                    task.skip('Skipped due to previous task failure (killOnFail)');
                    this.updateTaskInDatabase(task);
                    continue;
                }

                await this.executeTask(task);

                // Check if task failed and killOnFail is enabled
                if (taskConfig.killOnFail && task.status === TaskStatus.ERROR) {
                    console.log(`🛑 Task ${task.taskName} failed with killOnFail=true. Stopping remaining tasks in group.`);
                    shouldContinue = false;
                }
            }

            // Mark group as completed only if we executed all tasks or update status accordingly
            if (shouldContinue) {
                this.db.updateTaskGroup(taskGroupId, {
                    status: TaskStatus.COMPLETED,
                    message: 'All tasks completed successfully',
                    endTime: new Date().toISOString()
                });

                console.log(`✅ Task group completed: ${groupConfig.groupName}`);
            } else {
                this.db.updateTaskGroup(taskGroupId, {
                    status: TaskStatus.ERROR,
                    message: 'Task group stopped early due to task failure with killOnFail=true',
                    endTime: new Date().toISOString()
                });

                console.log(`⚠️ Task group partially completed: ${groupConfig.groupName} (stopped early due to killOnFail)`);
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const stackTrace = error instanceof Error ? error.stack || undefined : undefined;
            console.error(`❌ Task group failed: ${groupConfig.groupName} - ${errorMessage}`);
            if (stackTrace) {
                console.error(`Stack trace: ${stackTrace}`);
            }

            this.db.updateTaskGroup(taskGroupId, {
                status: TaskStatus.ERROR,
                message: `Task group failed: ${errorMessage}`,
                stackTrace: stackTrace,
                endTime: new Date().toISOString()
            });
        }
    }

    private async executeTask(task: MonitoredScheduledTask): Promise<void> {
        console.log(`🔄 Starting task: ${task.taskName}`);

        // Check if task is already running
        if (this.db.isTaskRunning(task.taskName)) {
            console.log(`⏭️ Skipping task ${task.taskName} - already running`);
            task.skip('Task already running');
            this.updateTaskInDatabase(task);
            return;
        }

        // Add to running tasks map
        this.runningTasks.set(task.taskId, task);

        // Set up event listeners for database updates
        task.on('statusChanged', () => this.updateTaskInDatabase(task));
        task.on('progressUpdated', () => this.updateTaskInDatabase(task));
        task.on('summaryUpdated', () => this.updateTaskInDatabase(task));

        try {
            await task.start();
            console.log(`✅ Task completed: ${task.taskName}`);
        } catch (error) {
            console.error(`❌ Task failed: ${task.taskName} - ${error}`);
        } finally {
            // Remove from running tasks map
            this.runningTasks.delete(task.taskId);

            // Final database update
            this.updateTaskInDatabase(task);
        }
    }

    private async createTask(taskConfig: TaskConfig, taskId: string, taskGroupId: string): Promise<{ task: MonitoredScheduledTask; calculatedParams: Record<string, any> }> {
        // Calculate lastChanged parameter if not provided
        const params = { ...taskConfig.params };

        // If lastChanged is not already set, calculate it from the last completed run
        if (!params.lastChanged) {
            const lastCompletedRun = this.db.getLastCompletedRun(taskConfig.name);
            if (lastCompletedRun && lastCompletedRun.startTime) {
                // Take the last start time and subtract 10 minutes
                const lastStartTime = new Date(lastCompletedRun.startTime);
                const lastChangedTime = new Date(lastStartTime.getTime() - 10 * 60 * 1000); // Subtract 10 minutes

                // Convert to Arizona time for MSSQL database filtering
                const arizonaTime = convertUtcToArizonaTime(lastChangedTime);
                params.lastChanged = arizonaTime.toISOString();
                console.log(`📅 Calculated lastChanged for ${taskConfig.name}: ${params.lastChanged} (converted from Arizona time)`);
            } else {
                // If no previous run, use a default time (1/1/2000) converted to Arizona time
                const defaultTime = new Date('2000-01-01T00:00:00.000Z');
                const arizonaTime = convertUtcToArizonaTime(defaultTime);
                params.lastChanged = arizonaTime.toISOString();
                console.log(`📅 Using default lastChanged for ${taskConfig.name}: ${params.lastChanged} (converted from Arizona time)`);
            }
        }

        // Dynamic import of the task file
        const taskPath = path.resolve(taskConfig.filePath);

        // Clear require cache to ensure fresh module load
        delete require.cache[require.resolve(taskPath)];
        const taskModule = require(taskPath);

        // Check if the module exports a MonitoredScheduledTask subclass
        if (taskModule.default &&
            typeof taskModule.default === 'function' &&
            taskModule.default.prototype &&
            taskModule.default.prototype instanceof MonitoredScheduledTask) {

            // Direct instantiation of MonitoredScheduledTask subclass
            console.log(`📦 Creating MonitoredScheduledTask instance for: ${taskConfig.name}`);
            const task = new taskModule.default(taskConfig.name, taskId, params);
            return { task, calculatedParams: params };
        } else {
            // Task doesn't extend MonitoredScheduledTask - this is now an error
            throw new Error(`Task ${taskConfig.name} (${taskConfig.filePath}) must extend MonitoredScheduledTask. Please convert this task to use the modern pattern.`);
        }
    }

    private updateTaskInDatabase(task: MonitoredScheduledTask): void {
        const updates: Partial<TaskRecord> = {
            status: task.status,
            message: task.error || task.currentProgress.message,
            startTime: task.startTime?.toISOString(),
            endTime: task.endTime?.toISOString(),
            summary: task.summary,
            percentage: task.currentProgress.percentage
        };

        this.db.updateTask(task.taskId, updates);
    }

    private startUpdateInterval(): void {
        this.updateInterval = setInterval(() => {
            // Update all running tasks in database
            this.runningTasks.forEach(task => {
                this.updateTaskInDatabase(task);
            });
        }, 3000); // Every 3 seconds
    }

    public getStatus(): any {
        return {
            isRunning: this.isRunning,
            scheduledTaskGroups: Array.from(this.scheduledTasks.keys()),
            runningTasks: Array.from(this.runningTasks.keys()),
            runningTaskGroups: this.db.getRunningTaskGroups().map((group: TaskGroupRecord) => group.groupName)
        };
    }

    public getTaskSummary(): any[] {
        // Group tasks by their task group
        const groupedData: any[] = [];

        this.taskConfigs.forEach(groupConfig => {
            // Calculate next run time for this group
            const nextRun = this.getNextCronTime(groupConfig.cron);

            // Get tasks for this group
            const groupTasks = groupConfig.tasks.map(taskConfig => {
                // Get the last completed run for this task
                const lastRun = this.db.getLastCompletedRun(taskConfig.name);

                // Check if there's a currently running task with this name
                const runningTask = Array.from(this.runningTasks.values())
                    .find(task => task.taskName === taskConfig.name);

                return {
                    taskName: taskConfig.name,
                    filePath: taskConfig.filePath,
                    lastStatus: lastRun?.status || 'never_run',
                    lastStartTime: lastRun?.startTime || null,
                    lastEndTime: lastRun?.endTime || null,
                    lastSummary: lastRun?.summary || null,
                    lastParams: lastRun?.params || null,
                    // Live information from running task instance (takes priority)
                    currentProgress: runningTask ? runningTask.currentProgress.message : null,
                    currentPercentage: runningTask ? runningTask.currentProgress.percentage : null,
                    currentStatus: runningTask ? runningTask.status : null,
                    currentStartTime: runningTask ? runningTask.startTime?.toISOString() : null,
                    currentError: runningTask ? runningTask.error : null,
                    currentParams: runningTask ? JSON.stringify((runningTask as any).params || {}) : null,
                    isRunning: !!runningTask,
                    // For non-running tasks, get most recent status from the last run
                    recentProgress: !runningTask && lastRun ? lastRun.message : null,
                    warningHours: taskConfig.warningHours,
                    errorHours: taskConfig.errorHours
                };
            });

            // Check if any task in this group is running
            const isGroupRunning = groupTasks.some(task => task.isRunning);

            groupedData.push({
                groupName: groupConfig.groupName,
                cronExpression: groupConfig.cron,
                nextRunTime: nextRun,
                isGroupRunning: isGroupRunning,
                tasks: groupTasks
            });
        });

        return groupedData;
    }

    public getErrorTasks(hours: number = 24): any[] {
        return this.db.getErrorTasks(hours);
    }

    public async runTaskGroupNow(groupName: string): Promise<void> {
        const scheduledTask = this.scheduledTasks.get(groupName);
        if (!scheduledTask) {
            throw new Error(`Task group not found: ${groupName}`);
        }

        console.log(`🔧 Manually triggering task group: ${groupName}`);
        await this.executeTaskGroup(scheduledTask.config);
    }

    public async runSingleTaskNow(groupName: string, taskName: string): Promise<void> {
        const scheduledTask = this.scheduledTasks.get(groupName);
        if (!scheduledTask) {
            throw new Error(`Task group not found: ${groupName}`);
        }

        // Find the specific task in the group
        const taskConfig = scheduledTask.config.tasks.find(task => task.name === taskName);
        if (!taskConfig) {
            throw new Error(`Task not found: ${taskName} in group ${groupName}`);
        }

        console.log(`🔧 Manually triggering single task: ${taskName} from group: ${groupName}`);

        // Create a temporary single-task group config
        const singleTaskGroupConfig: TaskGroupConfig = {
            groupName: `${groupName}_SingleTask_${taskName}`,
            cron: scheduledTask.config.cron,
            tasks: [taskConfig]
        };

        await this.executeTaskGroup(singleTaskGroupConfig);
    }

    public cleanup(daysToKeep: number = 30): void {
        console.log(`🧹 Cleaning up old records (keeping ${daysToKeep} days)`);
        this.db.cleanupOldRecords(daysToKeep);
    }

    private getNextCronTime(cronExpression: string): string | null {
        try {
            const cronJob = new Cron(cronExpression, {
                timezone: "America/Phoenix"
            });
            const nextRun = cronJob.nextRun();
            return nextRun ? nextRun.toISOString() : null;
        } catch (error) {
            console.error('❌ Invalid cron expression:', cronExpression, error);
            return null;
        }
    }
}
