import { EventEmitter } from "node:events";

export type PlanStepState = "queued" | "running" | "waiting_approval" | "completed" | "failed";

export type PlanStepEvent = {
  event: "plan.step";
  traceId: string;
  planId: string;
  step: {
    id: string;
    state: PlanStepState;
    capability: string;
    timeout_s: number;
    approval: boolean;
    summary?: string;
  };
};

const TERMINAL_STATES = new Set<PlanStepState>(["completed", "failed"]);
const MAX_EVENTS_PER_PLAN = 200;
export const HISTORY_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

type PlanHistoryEntry = {
  events: PlanStepEvent[];
  cleanupTimer?: NodeJS.Timeout;
};

const emitter = new EventEmitter();
const history = new Map<string, PlanHistoryEntry>();

function scheduleCleanup(planId: string, entry: PlanHistoryEntry): void {
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
  }
  entry.cleanupTimer = setTimeout(() => {
    history.delete(planId);
  }, HISTORY_RETENTION_MS);
  entry.cleanupTimer.unref?.();
}

export function publishPlanStepEvent(event: PlanStepEvent): void {
  const planId = event.planId;
  const entry = history.get(planId) ?? { events: [] };

  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = undefined;
  }

  entry.events = [...entry.events, event].slice(-MAX_EVENTS_PER_PLAN);
  history.set(planId, entry);
  emitter.emit(event.event, event);

  if (TERMINAL_STATES.has(event.step.state)) {
    scheduleCleanup(planId, entry);
  }
}

export function getPlanHistory(planId: string): PlanStepEvent[] {
  const entry = history.get(planId);
  return entry ? [...entry.events] : [];
}

export function subscribeToPlanSteps(planId: string, listener: (event: PlanStepEvent) => void): () => void {
  const scopedListener = (event: PlanStepEvent): void => {
    if (event.planId === planId) {
      listener(event);
    }
  };
  emitter.on("plan.step", scopedListener);
  return () => {
    emitter.off("plan.step", scopedListener);
  };
}

export function clearPlanHistory(): void {
  history.forEach(entry => {
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
    }
  });
  history.clear();
  emitter.removeAllListeners("plan.step");
}
