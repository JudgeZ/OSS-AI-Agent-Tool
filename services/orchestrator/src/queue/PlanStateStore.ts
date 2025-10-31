import fs from "node:fs/promises";
import path from "node:path";

import { randomUUID } from "node:crypto";

import type { PlanStep } from "../plan/planner.js";
import type { PlanStepState } from "../plan/validation.js";

type PersistedStep = {
  id: string;
  planId: string;
  stepId: string;
  traceId: string;
  step: PlanStep;
  state: PlanStepState;
  summary?: string;
  output?: Record<string, unknown>;
  updatedAt: string;
};

type PersistedDocument = {
  version: number;
  steps: PersistedStep[];
};

type PlanStateStoreOptions = {
  filePath?: string;
};

const TERMINAL_STATES: ReadonlySet<PlanStepState> = new Set([
  "completed",
  "failed",
  "rejected"
]);

function defaultPath(): string {
  const override = process.env.PLAN_STATE_PATH;
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(process.cwd(), "data", "plan-state.json");
}

export class PlanStateStore {
  private readonly filePath: string;
  private loaded = false;
  private readonly records = new Map<string, PersistedStep>();
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options?: PlanStateStoreOptions) {
    this.filePath = options?.filePath ?? defaultPath();
  }

  async rememberStep(
    planId: string,
    step: PlanStep,
    traceId: string,
    initialState: PlanStepState = "queued"
  ): Promise<void> {
    await this.ensureLoaded();
    const key = this.toKey(planId, step.id);
    const entry: PersistedStep = {
      id: randomUUID(),
      planId,
      stepId: step.id,
      traceId,
      step,
      state: initialState,
      updatedAt: new Date().toISOString()
    };
    this.records.set(key, entry);
    await this.enqueuePersist();
  }

  async setState(
    planId: string,
    stepId: string,
    state: PlanStepState,
    summary?: string,
    output?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureLoaded();
    const key = this.toKey(planId, stepId);
    const existing = this.records.get(key);
    if (!existing) {
      return;
    }

    if (TERMINAL_STATES.has(state)) {
      this.records.delete(key);
    } else {
      this.records.set(key, {
        ...existing,
        state,
        summary,
        output,
        updatedAt: new Date().toISOString()
      });
    }

    await this.enqueuePersist();
  }

  async forgetStep(planId: string, stepId: string): Promise<void> {
    await this.ensureLoaded();
    const key = this.toKey(planId, stepId);
    if (this.records.delete(key)) {
      await this.enqueuePersist();
    }
  }

  async listActiveSteps(): Promise<PersistedStep[]> {
    await this.ensureLoaded();
    return Array.from(this.records.values()).map(entry => ({ ...entry }));
  }

  async getStep(planId: string, stepId: string): Promise<{ step: PlanStep; traceId: string } | undefined> {
    await this.ensureLoaded();
    const record = this.records.get(this.toKey(planId, stepId));
    if (!record) {
      return undefined;
    }
    return { step: record.step, traceId: record.traceId };
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.records.clear();
    await this.enqueuePersist();
  }

  private toKey(planId: string, stepId: string): string {
    return `${planId}:${stepId}`;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.load();
    this.loaded = true;
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const document = JSON.parse(raw) as PersistedDocument;
      if (!Array.isArray(document.steps)) {
        return;
      }
      for (const entry of document.steps) {
        if (entry && typeof entry.planId === "string" && typeof entry.stepId === "string") {
          this.records.set(this.toKey(entry.planId, entry.stepId), entry);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private enqueuePersist(): Promise<void> {
    const run = this.persistChain.then(() => this.persist());
    this.persistChain = run.catch(() => {
      /* swallow persist errors for subsequent attempts */
    });
    return run;
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const payload: PersistedDocument = {
      version: 1,
      steps: Array.from(this.records.values())
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }
}

export function createPlanStateStore(options?: PlanStateStoreOptions): PlanStateStore {
  return new PlanStateStore(options);
}
