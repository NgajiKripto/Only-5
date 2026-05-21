import cron from "node-cron";
import { createLogger } from "./logger.js";

const logger = createLogger("scheduler");

export interface TaskInfo {
  name: string;
  expression: string;
  lastRun: Date | null;
  nextRun: Date | null;
  running: boolean;
}

interface RegisteredTask {
  name: string;
  expression: string;
  task: cron.ScheduledTask;
  lastRun: Date | null;
  running: boolean;
}

export class Scheduler {
  private tasks: Map<string, RegisteredTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  registerTask(
    name: string,
    cronExpression: string,
    handler: () => void | Promise<void>
  ): void {
    if (this.tasks.has(name)) {
      logger.warn(`Task "${name}" already exists, replacing`);
      this.removeTask(name);
    }

    const task = cron.schedule(
      cronExpression,
      async () => {
        const registered = this.tasks.get(name);
        if (!registered) return;

        registered.running = true;
        registered.lastRun = new Date();
        logger.debug(`Running task: ${name}`);

        try {
          await handler();
        } catch (error) {
          logger.error(`Task "${name}" failed`, {
            error: (error as Error).message,
          });
        } finally {
          if (this.tasks.has(name)) {
            const t = this.tasks.get(name)!;
            t.running = false;
          }
        }
      },
      { scheduled: false }
    );

    this.tasks.set(name, {
      name,
      expression: cronExpression,
      task,
      lastRun: null,
      running: false,
    });

    if (this.isRunning) {
      task.start();
      logger.debug(`Auto-started task: ${name} (scheduler is running)`);
    }

    logger.info(`Registered task: ${name} (${cronExpression})`);
  }

  removeTask(name: string): void {
    const registered = this.tasks.get(name);
    if (registered) {
      registered.task.stop();
      this.tasks.delete(name);
      logger.info(`Removed task: ${name}`);
    }

    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(name);
      logger.info(`Removed one-shot timer: ${name}`);
    }
  }

  listTasks(): TaskInfo[] {
    return Array.from(this.tasks.values()).map((t) => ({
      name: t.name,
      expression: t.expression,
      lastRun: t.lastRun,
      nextRun: null,
      running: t.running,
    }));
  }

  oneShot(
    name: string,
    delayMs: number,
    handler: () => void | Promise<void>
  ): void {
    if (this.timers.has(name)) {
      clearTimeout(this.timers.get(name)!);
    }

    const timer = setTimeout(async () => {
      logger.debug(`Running one-shot task: ${name}`);
      try {
        await handler();
      } catch (error) {
        logger.error(`One-shot task "${name}" failed`, {
          error: (error as Error).message,
        });
      } finally {
        this.timers.delete(name);
      }
    }, delayMs);

    this.timers.set(name, timer);
    logger.info(`Scheduled one-shot task: ${name} (in ${delayMs}ms)`);
  }

  startAll(): void {
    this.isRunning = true;
    for (const [name, registered] of this.tasks) {
      registered.task.start();
      logger.debug(`Started task: ${name}`);
    }
    logger.info(`Started ${this.tasks.size} tasks`);
  }

  stopAll(): void {
    this.isRunning = false;
    for (const [name, registered] of this.tasks) {
      registered.task.stop();
      logger.debug(`Stopped task: ${name}`);
    }
    for (const [name, timer] of this.timers) {
      clearTimeout(timer);
      logger.debug(`Cleared timer: ${name}`);
    }
    this.timers.clear();
    logger.info(`Stopped all tasks`);
  }
}
