import Database from 'better-sqlite3';
import { TaskStatus } from './MonitoredScheduledTask';

export interface TaskGroupRecord {
    taskGroupId: string;
    groupName: string;
    status: string;
    message?: string;
    startTime: string;
    endTime?: string;
    stackTrace?: string;
}

export interface TaskRecord {
    taskGroupId: string;
    taskId: string;
    taskName: string;
    params: string;
    filePath: string;
    status: string;
    message?: string;
    startTime?: string;
    endTime?: string;
    summary?: string;
    percentage?: number;
}

export class DatabaseManager {
    private db: Database.Database;
    private static instance: DatabaseManager;

    private constructor(dbPath: string = 'TaskScheduler.db') {
        this.db = new Database(dbPath);
        this.initializeTables();
    }

    public static getInstance(dbPath?: string): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager(dbPath);
        }
        return DatabaseManager.instance;
    }

    private initializeTables(): void {
        // Create taskGroups table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS taskGroups (
                taskGroupId TEXT PRIMARY KEY,
                groupName TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT,
                startTime TEXT NOT NULL,
                endTime TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create tasks table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                taskGroupId TEXT NOT NULL,
                taskId TEXT PRIMARY KEY,
                taskName TEXT NOT NULL,
                params TEXT NOT NULL,
                filePath TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT,
                startTime TEXT,
                endTime TEXT,
                summary TEXT,
                percentage INTEGER,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (taskGroupId) REFERENCES taskGroups (taskGroupId)
            )
        `);

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_taskGroups_status ON taskGroups(status);
            CREATE INDEX IF NOT EXISTS idx_taskGroups_groupName ON taskGroups(groupName);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_taskName ON tasks(taskName);
            CREATE INDEX IF NOT EXISTS idx_tasks_taskGroupId ON tasks(taskGroupId);
        `);

        // Run migrations
        this.runMigrations();

        this.cleanupOldRecords();

    }

    private runMigrations(): void {
        // Check if stackTrace column exists, if not add it
        const tableInfo = this.db.prepare("PRAGMA table_info(taskGroups)").all() as any[];
        const hasStackTrace = tableInfo.some((col: any) => col.name === 'stackTrace');
        
        if (!hasStackTrace) {
            console.log('Adding stackTrace column to taskGroups table...');
            this.db.exec('ALTER TABLE taskGroups ADD COLUMN stackTrace TEXT');
        }
    }

    // TaskGroup operations
    public insertTaskGroup(group: TaskGroupRecord): void {
        const stmt = this.db.prepare(`
            INSERT INTO taskGroups (taskGroupId, groupName, status, message, startTime, endTime, stackTrace)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(group.taskGroupId, group.groupName, group.status, group.message, group.startTime, group.endTime, group.stackTrace);
    }

    public updateTaskGroup(taskGroupId: string, updates: Partial<TaskGroupRecord>): void {
        const fields = Object.keys(updates).filter(key => key !== 'taskGroupId');
        if (fields.length === 0) return;

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => (updates as any)[field]);
        
        const stmt = this.db.prepare(`UPDATE taskGroups SET ${setClause} WHERE taskGroupId = ?`);
        stmt.run(...values, taskGroupId);
    }

    public getTaskGroup(taskGroupId: string): TaskGroupRecord | undefined {
        const stmt = this.db.prepare('SELECT * FROM taskGroups WHERE taskGroupId = ?');
        return stmt.get(taskGroupId) as TaskGroupRecord | undefined;
    }

    public getRunningTaskGroups(): TaskGroupRecord[] {
        const stmt = this.db.prepare('SELECT * FROM taskGroups WHERE status = ?');
        return stmt.all(TaskStatus.IN_PROGRESS) as TaskGroupRecord[];
    }

    public isTaskGroupRunning(groupName: string): boolean {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM taskGroups WHERE groupName = ? AND status = ?');
        const result = stmt.get(groupName, TaskStatus.IN_PROGRESS) as { count: number };
        return result.count > 0;
    }

    // Task operations
    public insertTask(task: TaskRecord): void {
        this.cleanupOldRecords();
        const stmt = this.db.prepare(`
            INSERT INTO tasks (taskGroupId, taskId, taskName, params, filePath, status, message, startTime, endTime, summary, percentage)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            task.taskGroupId, task.taskId, task.taskName, task.params, task.filePath,
            task.status, task.message, task.startTime, task.endTime, task.summary, task.percentage
        );
    }

    public updateTask(taskId: string, updates: Partial<TaskRecord>): void {
        const fields = Object.keys(updates).filter(key => key !== 'taskId');
        if (fields.length === 0) return;

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => (updates as any)[field]);
        
        const stmt = this.db.prepare(`UPDATE tasks SET ${setClause} WHERE taskId = ?`);
        stmt.run(...values, taskId);
    }

    public getTask(taskId: string): TaskRecord | undefined {
        const stmt = this.db.prepare('SELECT * FROM tasks WHERE taskId = ?');
        return stmt.get(taskId) as TaskRecord | undefined;
    }

    public getTasksByGroup(taskGroupId: string): TaskRecord[] {
        const stmt = this.db.prepare('SELECT * FROM tasks WHERE taskGroupId = ? ORDER BY createdAt');
        return stmt.all(taskGroupId) as TaskRecord[];
    }

    public isTaskRunning(taskName: string): boolean {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM tasks WHERE taskName = ? AND status = ?');
        const result = stmt.get(taskName, TaskStatus.IN_PROGRESS) as { count: number };
        return result.count > 0;
    }

    // Dashboard queries
    public getTaskSummary(): any[] {
        const stmt = this.db.prepare(`
            SELECT 
                t.taskName,
                t.status as lastStatus,
                t.startTime as lastStartTime,
                t.endTime as lastEndTime,
                t.summary as lastSummary,
                tg.groupName,
                CASE 
                    WHEN running.taskName IS NOT NULL THEN running.progress
                    ELSE NULL 
                END as currentProgress
            FROM tasks t
            INNER JOIN taskGroups tg ON t.taskGroupId = tg.taskGroupId
            LEFT JOIN (
                SELECT taskName, summary as progress 
                FROM tasks 
                WHERE status = 'in_progress'
            ) running ON t.taskName = running.taskName
            WHERE t.createdAt = (
                SELECT MAX(createdAt) 
                FROM tasks t2 
                WHERE t2.taskName = t.taskName
            )
            ORDER BY t.taskName
        `);
        return stmt.all();
    }

    public getErrorTasks(hours: number = 24): any[] {
        const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const stmt = this.db.prepare(`
            SELECT 
                t.taskName,
                t.taskGroupId,
                tg.groupName,
                t.status,
                t.message,
                t.startTime,
                t.endTime,
                t.summary,
                tg.stackTrace
            FROM tasks t
            INNER JOIN taskGroups tg ON t.taskGroupId = tg.taskGroupId
            WHERE t.status = 'error' AND t.startTime >= ?
            ORDER BY t.startTime DESC
        `);
        return stmt.all(cutoffTime);
    }

    public getLastCompletedRun(taskName: string): TaskRecord | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM tasks 
            WHERE taskName = ? AND status = 'completed'
            ORDER BY endTime DESC 
            LIMIT 1
        `);
        return stmt.get(taskName) as TaskRecord | undefined;
    }

    // Cleanup operations
    public cleanupOldRecords(daysToKeep: number = 30): void {
        const cutoffTime = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
        
        const deleteTasksStmt = this.db.prepare('DELETE FROM tasks WHERE createdAt < ?');
        const deleteGroupsStmt = this.db.prepare('DELETE FROM taskGroups WHERE createdAt < ?');
        
        const tasksDeleted = deleteTasksStmt.run(cutoffTime);
        const groupsDeleted = deleteGroupsStmt.run(cutoffTime);
        
        console.log(`Cleanup completed: ${tasksDeleted.changes} tasks and ${groupsDeleted.changes} task groups deleted`);
    }

    // Startup cleanup operations
    public markIncompleteTasksAsErrors(): void {
        console.log('🧹 Marking incomplete tasks and groups as errors...');
        
        const timestamp = new Date().toISOString();
        
        // Mark in-progress task groups as errors
        const updateGroupsStmt = this.db.prepare(`
            UPDATE taskGroups 
            SET status = 'error', 
                message = 'Marked as error: Application shutdown while in progress',
                endTime = ?
            WHERE status = 'in_progress'
        `);
        const groupsUpdated = updateGroupsStmt.run(timestamp);
        
        // Mark in-progress tasks as errors
        const updateTasksStmt = this.db.prepare(`
            UPDATE tasks 
            SET status = 'error',
                message = 'Marked as error: Application shutdown while in progress',
                endTime = ?
            WHERE status IN ('created', 'in_progress')
        `);
        const tasksUpdated = updateTasksStmt.run(timestamp);
        
        if (groupsUpdated.changes > 0 || tasksUpdated.changes > 0) {
            console.log(`🧹 Startup cleanup completed: ${tasksUpdated.changes} tasks and ${groupsUpdated.changes} task groups marked as errors`);
        } else {
            console.log('🧹 No incomplete tasks or groups found during startup');
        }
    }

    // Shutdown procedures
    public markRunningTasksAsShutdownErrors(): void {
        console.log('🛑 Marking running tasks as shutdown errors...');
        
        const timestamp = new Date().toISOString();
        
        // Mark running task groups as errors
        const updateGroupsStmt = this.db.prepare(`
            UPDATE taskGroups 
            SET status = 'error', 
                message = 'Marked as error: Application shutdown during execution',
                endTime = ?
            WHERE status = 'in_progress'
        `);
        const groupsUpdated = updateGroupsStmt.run(timestamp);
        
        // Mark running tasks as errors
        const updateTasksStmt = this.db.prepare(`
            UPDATE tasks 
            SET status = 'error',
                message = 'Marked as error: Application shutdown during execution',
                endTime = ?
            WHERE status IN ('created', 'in_progress')
        `);
        const tasksUpdated = updateTasksStmt.run(timestamp);
        
        if (groupsUpdated.changes > 0 || tasksUpdated.changes > 0) {
            console.log(`🛑 Shutdown cleanup: ${tasksUpdated.changes} tasks and ${groupsUpdated.changes} task groups marked as shutdown errors`);
        }
    }

    // Shutdown and startup cleanup methods
    public markInProgressTasksAsShutdown(): void {
        const currentTime = new Date().toISOString();
        const shutdownMessage = 'Task interrupted by application shutdown';
        
        // Mark all in-progress tasks as error
        const updateTasksStmt = this.db.prepare(`
            UPDATE tasks 
            SET status = ?, message = ?, endTime = ?
            WHERE status = ?
        `);
        const tasksUpdated = updateTasksStmt.run(TaskStatus.ERROR, shutdownMessage, currentTime, TaskStatus.IN_PROGRESS);
        
        // Mark all in-progress task groups as error
        const updateGroupsStmt = this.db.prepare(`
            UPDATE taskGroups 
            SET status = ?, message = ?, endTime = ?
            WHERE status = ?
        `);
        const groupsUpdated = updateGroupsStmt.run(TaskStatus.ERROR, shutdownMessage, currentTime, TaskStatus.IN_PROGRESS);
        
        console.log(`Shutdown cleanup: ${tasksUpdated.changes} tasks and ${groupsUpdated.changes} task groups marked as shutdown errors`);
    }

    public cleanupInProgressRecords(): void {
        // Delete all in-progress tasks and groups (they're from a previous interrupted session)
        // Need to delete tasks first due to foreign key constraint
        const deleteTasksStmt = this.db.prepare('DELETE FROM tasks WHERE status = ?');
        const deleteGroupsStmt = this.db.prepare('DELETE FROM taskGroups WHERE status = ?');
        
        const tasksDeleted = deleteTasksStmt.run(TaskStatus.IN_PROGRESS);
        const groupsDeleted = deleteGroupsStmt.run(TaskStatus.IN_PROGRESS);
        
        if (tasksDeleted.changes > 0 || groupsDeleted.changes > 0) {
            console.log(`🧹 Startup cleanup: Removed ${tasksDeleted.changes} in-progress tasks and ${groupsDeleted.changes} in-progress task groups from previous session`);
        }
    }

    public close(): void {
        this.db.close();
    }
}
