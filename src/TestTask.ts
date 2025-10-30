// Simple test task for demonstration
import { MonitoredScheduledTask } from './MonitoredScheduledTask';

export default class TestTask extends MonitoredScheduledTask {

  constructor(taskName: string, taskId: string, params: any = {}) {
        super(taskName, taskId, params);
    }

    protected async execute(): Promise<void> {
        this.updateProgress('Starting test task...', 0);
        
        // Simulate some work with longer delays to see progress
        await this.delay(3000);
        this.updateProgress('Processing data...', 25);
        
        await this.delay(3000);
        this.updateProgress('Halfway complete...', 50);
        
        await this.delay(3000);
        this.updateProgress('Almost done...', 75);
        
        await this.delay(3000);
        this.updateProgress('Finalizing...', 90);
        
        await this.delay(2000);
        this.updateProgress('Task completed!', 100);
        
        this.setSummary('Test task completed successfully - processed 42 items');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
