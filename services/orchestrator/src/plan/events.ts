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

const emitter = new EventEmitter();
const history = new Map<string, PlanStepEvent[]>();

export function publishPlanStepEvent(event: PlanStepEvent): void {
  const planHistory = history.get(event.planId) ?? [];
  planHistory.push(event);
  history.set(event.planId, planHistory);
  emitter.emit(event.event, event);
}

export function getPlanHistory(planId: string): PlanStepEvent[] {
  return history.get(planId) ?? [];
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
  history.clear();
  emitter.removeAllListeners("plan.step");
}
