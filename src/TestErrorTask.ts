// Simple test task for demonstration
import { MonitoredScheduledTask } from './MonitoredScheduledTask';

export default class TestTask extends MonitoredScheduledTask {

  constructor(taskName: string, taskId: string, params: any = {}) {
        super(taskName, taskId, params);
    }

    protected async execute(): Promise<void> {
        this.updateProgress('Starting test task...', 0);
        
        // Simulate some work with longer delays to see progress
        await this.delay(1000);
        this.updateProgress('Processing data...', 25);
        
        throw new Error('Simulated task error for testing purposes');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
