/**
 * platform/companion/schedules.ts — Module 12: Scheduled Agents
 *
 * WHY: Allows users to define recurring automations (e.g., "every morning at 9 AM,
 * export my CRM leads"). Uses node-cron to manage schedules and persists them to disk
 * so they survive server restarts.
 */

import * as cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';

const SCHEDULES_FILE = path.resolve('./platform/companion/schedules.json');

export interface Schedule {
  id: string;
  name: string;
  cronExpression: string; // e.g., "0 9 * * 1-5" = weekdays at 9 AM
  capabilityId: string;
  params: Record<string, unknown>;
  targetUrl: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'error';
}

// In-memory map of active cron tasks
const activeTasks = new Map<string, cron.ScheduledTask>();

// Callback registered by the server to execute a capability when triggered
let executeCallback: ((capabilityId: string, params: Record<string, unknown>, targetUrl: string) => Promise<void>) | null = null;

export function registerExecuteCallback(
  cb: (capabilityId: string, params: Record<string, unknown>, targetUrl: string) => Promise<void>
): void {
  executeCallback = cb;
}

function loadSchedules(): Schedule[] {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveSchedules(schedules: Schedule[]): void {
  const dir = path.dirname(SCHEDULES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

function registerCronJob(schedule: Schedule): void {
  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cronExpression)) {
    console.warn(`[Scheduler] Invalid cron expression for "${schedule.name}": ${schedule.cronExpression}`);
    return;
  }

  const task = cron.schedule(schedule.cronExpression, async () => {
    console.log(`[Scheduler] Firing scheduled job: "${schedule.name}" (${schedule.id})`);
    const schedules = loadSchedules();
    const entry = schedules.find(s => s.id === schedule.id);
    if (!entry) return;

    entry.lastRunAt = new Date().toISOString();

    try {
      if (executeCallback) {
        await executeCallback(schedule.capabilityId, schedule.params, schedule.targetUrl);
        entry.lastRunStatus = 'success';
        console.log(`[Scheduler] ✅ Job "${schedule.name}" completed`);
      }
    } catch (err: any) {
      entry.lastRunStatus = 'error';
      console.error(`[Scheduler] ❌ Job "${schedule.name}" failed:`, err.message);
    }

    saveSchedules(schedules);
  });

  activeTasks.set(schedule.id, task);
}

/** Load all persisted schedules and register them with cron on server start */
export function initScheduler(): void {
  const schedules = loadSchedules();
  console.log(`[Scheduler] Loading ${schedules.length} scheduled jobs...`);
  schedules.forEach(registerCronJob);
}

export function createSchedule(schedule: Omit<Schedule, 'id' | 'createdAt'>): Schedule {
  if (!cron.validate(schedule.cronExpression)) {
    throw new Error(`Invalid cron expression: ${schedule.cronExpression}`);
  }

  const newSchedule: Schedule = {
    ...schedule,
    id: Math.random().toString(36).substring(2, 10),
    createdAt: new Date().toISOString(),
  };

  const schedules = loadSchedules();
  schedules.push(newSchedule);
  saveSchedules(schedules);
  registerCronJob(newSchedule);

  return newSchedule;
}

export function deleteSchedule(id: string): boolean {
  const task = activeTasks.get(id);
  if (task) {
    task.stop();
    activeTasks.delete(id);
  }

  const schedules = loadSchedules();
  const filtered = schedules.filter(s => s.id !== id);
  if (filtered.length === schedules.length) return false;
  saveSchedules(filtered);
  return true;
}

export function listSchedules(): Schedule[] {
  return loadSchedules();
}
