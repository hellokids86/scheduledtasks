import { EventEmitter } from 'events';

export enum TaskStatus {
    CREATED = 'created',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    ERROR = 'error',
    SKIPPED = 'skipped'
}

export interface TaskProgress {
    message: string;
    percentage?: number;
}

export abstract class MonitoredScheduledTask extends EventEmitter {
    private _taskId: string;
    private _taskName: string;
    private _startTime?: Date;
    private _endTime?: Date;
    private _status: TaskStatus = TaskStatus.CREATED;
    private _error?: string;
    private _summary?: string;
    private _currentProgress: TaskProgress = { message: 'Initialized' };
    protected params: Record<string, any>;

    constructor(taskName: string, taskId: string, params: Record<string, any> = {}) {
        super();
        this._taskName = taskName;
        this._taskId = taskId;
        this.params = params;
    }

    // Getters
    get taskId(): string { return this._taskId; }
    get taskName(): string { return this._taskName; }
    get startTime(): Date | undefined { return this._startTime; }
    get endTime(): Date | undefined { return this._endTime; }
    get status(): TaskStatus { return this._status; }
    get error(): string | undefined { return this._error; }
    get summary(): string | undefined { return this._summary; }
    get currentProgress(): TaskProgress { return this._currentProgress; }
    get taskParams(): Record<string, any> { return this.params; }

    // Status management methods
    protected setStatus(status: TaskStatus): void {
        this._status = status;
        this.emit('statusChanged', {
            taskId: this._taskId,
            status: this._status,
            timestamp: new Date()
        });
    }

    protected setError(error: string): void {
        this._error = error;
        this._status = TaskStatus.ERROR;
        this.emit('statusChanged', {
            taskId: this._taskId,
            status: this._status,
            error: this._error,
            timestamp: new Date()
        });
    }

    protected setSummary(summary: string): void {
        this._summary = summary;
        this.emit('summaryUpdated', {
            taskId: this._taskId,
            summary: this._summary,
            timestamp: new Date()
        });
    }

    protected updateProgress(message: string, percentage?: number): void {
        this._currentProgress = { message, percentage };
        this.emit('progressUpdated', {
            taskId: this._taskId,
            progress: this._currentProgress,
            timestamp: new Date()
        });
    }

    // Task lifecycle methods
    public async start(): Promise<void> {
        try {
            this._startTime = new Date();
            this.setStatus(TaskStatus.IN_PROGRESS);
            this.updateProgress('Starting task...');
            
            await this.execute();
            
            this._endTime = new Date();
            this.setStatus(TaskStatus.COMPLETED);
            this.updateProgress('Task completed');
        } catch (error) {
            this._endTime = new Date();
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.setError(errorMessage);
            this.updateProgress('Task failed with error');
            throw error;
        }
    }

    public skip(reason: string): void {
        this.setStatus(TaskStatus.SKIPPED);
        this.updateProgress(`Task skipped: ${reason}`);
        this._summary = reason;
    }

    // Abstract method to be implemented by concrete task classes
    protected abstract execute(): Promise<void>;

    // Helper method to get task duration
    public getDuration(): number | undefined {
        if (this._startTime && this._endTime) {
            return this._endTime.getTime() - this._startTime.getTime();
        }
        return undefined;
    }

    // Helper method to get task data for database storage
    public getTaskData(): any {
        return {
            taskId: this._taskId,
            taskName: this._taskName,
            startTime: this._startTime?.toISOString(),
            endTime: this._endTime?.toISOString(),
            status: this._status,
            error: this._error,
            summary: this._summary,
            currentProgress: JSON.stringify(this._currentProgress)
        };
    }
}
