# TaskScheduler

A lightweight TypeScript-based task scheduler with a simple web dashboard and APIs for monitoring and manually triggering scheduled tasks.

This project runs scheduled task groups (cron-based) that execute TypeScript task modules. Each task module is a class that extends `MonitoredScheduledTask` (see `src/MonitoredScheduledTask.ts`) and emits progress, status and summary updates that are stored in a local database.

## Key features

- Cron-based task groups
- Per-task progress/reporting via event-driven `MonitoredScheduledTask` subclasses
- Web dashboard with live status and manual triggers
- REST API endpoints for status, task summary, errors and manual execution
- Simple configuration via a JSON file (see `data/example_task_config.json`)

## Installation

### As a standalone application

1. Clone this repository
2. Install dependencies

```powershell
npm install
```

3. Copy the example config to `data/task_config.json` and adjust it to your needs:

```powershell
copy data\example_task_config.json data\task_config.json
```

4. Start the server (uses `ts-node` to run TypeScript in-place):

```powershell
npm start
```

- The server will start on `http://localhost:3000` by default (or `PORT` env var).
- Dashboard: `http://localhost:3000/task-scheduler`
- Health: `http://localhost:3000/health`

Run in development with automatic reload (watch):

```powershell
npm run dev
```

There are also existing `scheduler` scripts in `package.json` (if present) which run `TaskScheduler-start.ts`.

### As a Node.js module

You can also install this as a dependency in another Node.js project:

```bash
npm install scheduledtasks
```

Then use it in your project:

```typescript
import { TaskScheduler, MonitoredScheduledTask, TaskStatus } from 'scheduledtasks';
import express from 'express';

// Create a custom task
class MyCustomTask extends MonitoredScheduledTask {
  protected async execute(): Promise<void> {
    this.updateProgress('Starting my task...', 0);
    // Do your work here
    await this.doSomeWork();
    this.updateProgress('Task completed!', 100);
    this.setSummary('Successfully processed data');
  }

  private async doSomeWork(): Promise<void> {
    // Your task logic here
  }
}

// Set up the scheduler
const scheduler = new TaskScheduler('path/to/your/task_config.json');
scheduler.start();

// Optional: Set up web dashboard
const app = express();
const { setupDashboard } = require('scheduledtasks');
await setupDashboard(app, scheduler);
app.listen(3000);
```

Configuration file format remains the same, but your `filePath` should point to your custom task modules.

## Configuration: `example_task_config.json`

The scheduler is configured with a JSON file containing an array of task groups. A minimal example is included at `data/example_task_config.json`.

Top-level structure:

- `groupName` (string): Logical name for the task group
- `cron` (string): Cron expression (node-cron format) describing when the group runs
- `warningHours` (number): Hours threshold for "warning" age of a task (UI/DB logic)
- `errorHours` (number): Hours threshold for "error" age of a task (UI/DB logic)
- `tasks` (array): List of tasks in this group

Each task object:

- `name` (string): Name of the task (used to identify last runs)
- `filePath` (string): Path to the TypeScript task module (relative or absolute). Example: `src/TestTask.ts`
- `params` (object): Arbitrary key/value params passed to the task constructor
- `warningHours` (number) and `errorHours` (number): Per-task thresholds (optional)

Example (from `data/example_task_config.json`):

```json
[
  {
    "groupName": "Test Group",
    "cron": "*/5 * * * *",
    "warningHours": 0.1,
    "errorHours": 0.05,
    "tasks": [
      {
        "name": "Test Task",
        "filePath": "src/TestTask.ts",
        "params": { "testParam": "hello world" },
        "warningHours": 0.1,
        "errorHours": 0.05
      }
    ]
  }
]
```

How to use your own config:

1. Create a copy of the example file and name it `data/task_config.json`.
2. Update `filePath` to point to your task module file(s).
3. Start the server and verify groups load (console logs list scheduled groups).

Notes:
- `filePath` values are resolved using `path.resolve()`, so relative paths are resolved against the process working directory (project root when running via `npm start`).
- The scheduler dynamically requires task modules at runtime and expects a `default` export (see "Extending MonitoredScheduledTask" below).

## API Endpoints (prefix: `/task-scheduler/api/`)

The server exposes the following REST endpoints for the dashboard and automation:

- `GET /task-scheduler/api/status` — Returns general scheduler status (isRunning, scheduled groups, running tasks)
- `GET /task-scheduler/api/task-summary` — Returns grouped task summaries including last run info and live progress
- `GET /task-scheduler/api/errors?hours=N` — Returns error tasks within the last `N` hours (default 24)
- `POST /task-scheduler/api/run-group/:groupName` — Manually trigger a whole task group (async)
- `POST /task-scheduler/api/run-task/:groupName/:taskName` — Manually trigger a single task within a group (async)
- `POST /task-scheduler/api/cleanup` — Cleanup old DB records; expects body `{ days: number }`

Use these endpoints from the dashboard UI (already wired in the `web/` pages) or via scripts/automation.

## Extending MonitoredScheduledTask (create your own task)

Task modules are TypeScript files that default-export a class that extends `MonitoredScheduledTask` from `src/MonitoredScheduledTask.ts`.

Contract / expectations:

- Export `default` a class that extends `MonitoredScheduledTask`.
- Constructor signature: `constructor(taskName: string, taskId: string, params: Record<string, any> = {})` — call `super(taskName, taskId, params)` in your constructor.
- Implement the protected async `execute(): Promise<void>` method. This is where the task does its work.
- Use the helper methods inside your task to report state:
  - `this.updateProgress(message: string, percentage?: number)` — emit progress updates for the dashboard/DB
  - `this.setSummary(summary: string)` — set a final summary string
  - `this.setError(errorMessage: string)` — mark the task as errored and emit status change
  - `this.skip(reason: string)` — mark task as skipped

Events emitted by base class (useful for tests):

- `statusChanged` — emitted when status changes (created, in_progress, completed, error, skipped)
- `progressUpdated` — emitted when progress updates
- `summaryUpdated` — emitted when summary changes

Minimal example (see `src/TestTask.ts`):

```ts
import { MonitoredScheduledTask } from './ScheduledTask';

export default class TestTask extends MonitoredScheduledTask {
  constructor(taskName: string, taskId: string, params: any = {}) {
    super(taskName, taskId, params);
  }

  protected async execute(): Promise<void> {
    this.updateProgress('Starting...', 0);
    // ... do work
    this.updateProgress('Done', 100);
    this.setSummary('Completed successfully');
  }
}
```

Important: dynamic loading will `require()` the resolved `filePath`. The module must be loadable via Node's `require` (TypeScript + ts-node allows `.ts` files at runtime when using `ts-node`).

### Example project structure when using as a module

```
my-project/
├── package.json
├── src/
│   ├── tasks/
│   │   ├── DataSyncTask.ts
│   │   └── ReportTask.ts
│   └── server.ts
├── config/
│   └── task_config.json
└── tsconfig.json
```

Example `package.json`:

```json
{
  "name": "my-scheduled-app",
  "dependencies": {
    "scheduledtasks": "^1.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.0.0"
  },
  "scripts": {
    "start": "ts-node src/server.ts"
  }
}
```

### Publishing to npm

If you want to publish this as your own npm package:

```bash
npm run build
npm publish
```

The `prepublishOnly` script will automatically build the project before publishing.

## Database

A local SQLite database (`TaskScheduler.db`) is used via `better-sqlite3` and is managed by `src/DatabaseManager.ts`. The DB stores task groups, task runs, errors and metadata.

## Troubleshooting

- TypeScript `.ts` import errors: ensure `tsconfig.json` exists (this project includes one) and `ts-node` is installed (devDependency). `npm start` uses `npx ts-node`.
- Port conflicts: if `EADDRINUSE` occurs, ensure nothing else is listening on the configured `PORT` (default 3000); stop other processes or change `PORT` env var.
- Static files: the dashboard pages are under `web/` and served from `/task-scheduler` and `/task-scheduler/errors`.
- If your task module isn't loading, check the `filePath` and ensure the file `default`-exports a class extending `MonitoredScheduledTask`.

## Contributing & Next steps

- Add unit tests for task modules and DatabaseManager
- Add authentication for dashboard API if exposing publicly
- Add better validation for `task_config.json` (schema & helpful errors)

---

If you want, I can also add a small example `data/task_config.json` (copied from the example file) and a short script to validate configs. Would you like that?