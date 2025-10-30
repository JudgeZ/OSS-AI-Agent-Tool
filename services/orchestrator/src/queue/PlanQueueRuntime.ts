import { queueDepthGauge } from "../observability/metrics.js";
import { publishPlanStepEvent } from "../plan/events.js";
import type { Plan, PlanStep } from "../plan/planner.js";
import { getQueueAdapter } from "./QueueAdapter.js";

export const PLAN_STEPS_QUEUE = "plan.steps";
export const PLAN_COMPLETIONS_QUEUE = "plan.completions";

export type PlanStepTaskPayload = {
  planId: string;
  step: PlanStep;
  traceId: string;
};

export type PlanStepCompletionPayload = {
  planId: string;
  stepId: string;
  state: "completed" | "failed";
  summary?: string;
  capability?: string;
  timeout_s?: number;
  approval?: boolean;
  traceId?: string;
};

const stepRegistry = new Map<string, { step: PlanStep; traceId: string }>();
let initialized: Promise<void> | null = null;

export async function initializePlanQueueRuntime(): Promise<void> {
  if (!initialized) {
    initialized = setupCompletionConsumer().catch(error => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}

export function resetPlanQueueRuntime(): void {
  initialized = null;
  stepRegistry.clear();
}

export async function submitPlanSteps(plan: Plan, traceId: string): Promise<void> {
  await initializePlanQueueRuntime();
  const adapter = await getQueueAdapter();

  const submissions = plan.steps.map(async step => {
    const key = `${plan.id}:${step.id}`;
    stepRegistry.set(key, { step, traceId });
    await adapter.enqueue<PlanStepTaskPayload>(PLAN_STEPS_QUEUE, { planId: plan.id, step, traceId }, {
      idempotencyKey: key,
      headers: { "trace-id": traceId }
    });
  });

  await Promise.all(submissions);
  const depth = await adapter.getQueueDepth(PLAN_STEPS_QUEUE);
  queueDepthGauge.labels(PLAN_STEPS_QUEUE).set(depth);
}

async function setupCompletionConsumer(): Promise<void> {
  const adapter = await getQueueAdapter();
  await adapter.consume<PlanStepCompletionPayload>(PLAN_COMPLETIONS_QUEUE, async message => {
    const payload = message.payload;
    const key = `${payload.planId}:${payload.stepId}`;
    const metadata = stepRegistry.get(key);
    const baseStep = metadata?.step;
    const traceId =
      payload.traceId ||
      metadata?.traceId ||
      message.headers["trace-id"] ||
      message.headers["traceId"] ||
      message.headers["Trace-Id"] ||
      "";

    publishPlanStepEvent({
      event: "plan.step",
      traceId: traceId || message.id,
      planId: payload.planId,
      step: {
        id: payload.stepId,
        state: payload.state,
        capability: payload.capability ?? baseStep?.capability ?? "unknown",
        timeout_s: payload.timeout_s ?? baseStep?.timeout_s ?? 0,
        approval: payload.approval ?? baseStep?.approval ?? false,
        summary: payload.summary
      }
    });

    if (payload.state === "completed" || payload.state === "failed") {
      stepRegistry.delete(key);
    }

    await message.ack();
  });
}
