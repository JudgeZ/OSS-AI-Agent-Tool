import fs from "node:fs/promises";
import { dirname } from "node:path";
import path from "node:path";

import type { PlanStep } from "../plan/planner.js";

type StepLifecycle = "queued" | "running" | "completed";

type StepRecord = {
  step: PlanStep;
  traceId: string;
  state: StepLifecycle;
  resumed?: boolean;
};

type PlanRecord = {
  steps: Map<string, StepRecord>;
};

type PersistedPlanRecord = {
  steps: Record<string, StepRecord>;
};

type PersistedState = {
  version: number;
  plans: Record<string, PersistedPlanRecord>;
};

const DEFAULT_STORE_PATH = process.env.PLAN_RUNTIME_STORE_PATH
  ? path.resolve(process.env.PLAN_RUNTIME_STORE_PATH)
  : path.join(process.cwd(), ".runtime", "plan-runtime-state.json");

async function ensureDirectory(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

export class PlanResumeStore {
  private readonly filePath: string;
  private readonly plans = new Map<string, PlanRecord>();
  private readonly persistQueue: (() => Promise<void>)[] = [];
  private persisting = false;
  private ready: Promise<void>;

  constructor(filePath: string = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    this.ready = this.loadFromDisk();
  }

  async recordQueued(planId: string, step: PlanStep, traceId: string): Promise<void> {
    await this.ready;
    const plan = this.getOrCreatePlan(planId);
    const existing = plan.steps.get(step.id);
    plan.steps.set(step.id, {
      step,
      traceId,
      state: "queued",
      resumed: existing?.resumed ?? false
    });
    await this.persistSoon();
  }

  async markRunning(planId: string, step: PlanStep, traceId: string): Promise<boolean> {
    await this.ready;
    const plan = this.getOrCreatePlan(planId);
    const existing = plan.steps.get(step.id);
    if (existing?.state === "completed") {
      return false;
    }
    plan.steps.set(step.id, {
      step,
      traceId,
      state: "running",
      resumed: existing?.resumed ?? false
    });
    await this.persistSoon();
    return true;
  }

  async markQueuedAfterRetry(planId: string, step: PlanStep, traceId: string): Promise<void> {
    await this.ready;
    const plan = this.getOrCreatePlan(planId);
    const existing = plan.steps.get(step.id);
    plan.steps.set(step.id, {
      step,
      traceId,
      state: "queued",
      resumed: existing?.resumed ?? true
    });
    await this.persistSoon();
  }

  async markCompleted(planId: string, stepId: string): Promise<void> {
    await this.ready;
    const plan = this.plans.get(planId);
    if (!plan) {
      return;
    }
    const existing = plan.steps.get(stepId);
    if (!existing) {
      return;
    }
    existing.state = "completed";
    plan.steps.set(stepId, existing);
    const hasPending = Array.from(plan.steps.values()).some(record => record.state !== "completed");
    if (!hasPending) {
      this.plans.delete(planId);
    }
    await this.persistSoon();
  }

  async getResumableSteps(): Promise<Array<{ planId: string; step: PlanStep; traceId: string }>> {
    await this.ready;
    const entries: Array<{ planId: string; step: PlanStep; traceId: string }> = [];
    for (const [planId, plan] of this.plans.entries()) {
      for (const record of plan.steps.values()) {
        if (record.state === "running") {
          entries.push({ planId, step: record.step, traceId: record.traceId });
        }
      }
    }
    return entries;
  }

  async clearAll(): Promise<void> {
    await this.ready;
    this.plans.clear();
    await this.writeToDisk();
  }

  private getOrCreatePlan(planId: string): PlanRecord {
    let plan = this.plans.get(planId);
    if (!plan) {
      plan = { steps: new Map() };
      this.plans.set(planId, plan);
    }
    return plan;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version !== 1 || typeof parsed.plans !== "object" || !parsed.plans) {
        return;
      }
      for (const [planId, planRecord] of Object.entries(parsed.plans)) {
        if (!planRecord || typeof planRecord !== "object" || typeof planRecord.steps !== "object") {
          continue;
        }
        const plan: PlanRecord = { steps: new Map() };
        for (const [stepId, record] of Object.entries(planRecord.steps)) {
          if (!record || typeof record !== "object") {
            continue;
          }
          plan.steps.set(stepId, {
            step: record.step as PlanStep,
            traceId: record.traceId,
            state: (record.state as StepLifecycle) ?? "queued",
            resumed: record.resumed ?? false
          });
        }
        if (plan.steps.size > 0) {
          this.plans.set(planId, plan);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private async persistSoon(): Promise<void> {
    this.persistQueue.push(() => this.writeToDisk());
    if (this.persisting) {
      return;
    }
    this.persisting = true;
    while (this.persistQueue.length > 0) {
      const task = this.persistQueue.shift();
      if (!task) {
        continue;
      }
      await task();
    }
    this.persisting = false;
  }

  private async writeToDisk(): Promise<void> {
    if (this.plans.size === 0) {
      try {
        await fs.rm(this.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    const payload: PersistedState = {
      version: 1,
      plans: {}
    };
    for (const [planId, plan] of this.plans.entries()) {
      const steps: Record<string, StepRecord> = {};
      for (const [stepId, record] of plan.steps.entries()) {
        steps[stepId] = record;
      }
      payload.plans[planId] = { steps };
    }
    await ensureDirectory(this.filePath);
    await fs.writeFile(this.filePath, JSON.stringify(payload));
  }
}

export const defaultPlanResumeStore = new PlanResumeStore();
