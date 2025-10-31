import { randomUUID } from "node:crypto";

import { queueDepthGauge } from "../observability/metrics.js";
import { publishPlanStepEvent } from "../plan/events.js";
import type { Plan, PlanStep } from "../plan/planner.js";
import { getToolAgentClient, resetToolAgentClient, ToolClientError } from "../grpc/AgentClient.js";
import type { ToolEvent } from "../plan/validation.js";
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
  capabilityLabel?: string;
  labels?: string[];
  tool?: string;
  timeoutSeconds?: number;
  approvalRequired?: boolean;
  traceId?: string;
  occurredAt?: string;
};

const stepRegistry = new Map<string, { step: PlanStep; traceId: string }>();
let initialized: Promise<void> | null = null;

const TERMINAL_STATES = new Set<ToolEvent["state"]>(["completed", "failed"]);

function emitPlanEvent(
  planId: string,
  step: PlanStep,
  traceId: string,
  update: Partial<ToolEvent> & { state: ToolEvent["state"]; summary?: string }
): void {
  publishPlanStepEvent({
    event: "plan.step",
    traceId,
    planId,
    occurredAt: update.occurredAt ?? new Date().toISOString(),
    step: {
      id: step.id,
      action: step.action,
      tool: step.tool,
      state: update.state,
      capability: step.capability,
      capabilityLabel: step.capabilityLabel,
      labels: step.labels,
      timeoutSeconds: step.timeoutSeconds,
      approvalRequired: step.approvalRequired,
      summary: update.summary ?? undefined
    }
  });
}

function publishToolEvents(planId: string, baseStep: PlanStep, traceId: string, events: ToolEvent[]): void {
  for (const event of events) {
    emitPlanEvent(planId, baseStep, traceId, {
      state: event.state,
      summary: event.summary,
      occurredAt: event.occurredAt
    });
  }
}

export async function initializePlanQueueRuntime(): Promise<void> {
  if (!initialized) {
    initialized = Promise.all([setupStepConsumer(), setupCompletionConsumer()])
      .then(() => undefined)
      .catch(error => {
        initialized = null;
        throw error;
      });
  }
  await initialized;
}

export function resetPlanQueueRuntime(): void {
  initialized = null;
  stepRegistry.clear();
  resetToolAgentClient();
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
      occurredAt: payload.occurredAt ?? new Date().toISOString(),
      step: {
        id: payload.stepId,
        action: baseStep?.action ?? payload.stepId,
        tool: payload.tool ?? baseStep?.tool ?? payload.stepId,
        state: payload.state,
        capability: payload.capability ?? baseStep?.capability ?? "unknown",
        capabilityLabel: payload.capabilityLabel ?? baseStep?.capabilityLabel ?? payload.capability ?? "unknown",
        labels: payload.labels ?? baseStep?.labels ?? [],
        timeoutSeconds: payload.timeoutSeconds ?? baseStep?.timeoutSeconds ?? 0,
        approvalRequired: payload.approvalRequired ?? baseStep?.approvalRequired ?? false,
        summary: payload.summary
      }
    });

    if (payload.state === "completed" || payload.state === "failed") {
      stepRegistry.delete(key);
    }

    await message.ack();
  });
}

async function setupStepConsumer(): Promise<void> {
  const adapter = await getQueueAdapter();
  await adapter.consume<PlanStepTaskPayload>(PLAN_STEPS_QUEUE, async message => {
    const payload = message.payload;
    const planId = payload.planId;
    const step = payload.step;
    const traceId = payload.traceId || message.headers["trace-id"] || message.id;
    const invocationId = randomUUID();

    emitPlanEvent(planId, step, traceId, { state: "running", summary: "Dispatching tool agent" });

    try {
      const client = getToolAgentClient();
      const events = await client.executeTool(
        {
          invocationId,
          planId,
          stepId: step.id,
          tool: step.tool,
          capability: step.capability,
          capabilityLabel: step.capabilityLabel,
          labels: step.labels,
          timeoutSeconds: step.timeoutSeconds,
          approvalRequired: step.approvalRequired,
          input: step.input,
          metadata: step.metadata ?? {}
        },
        {
          timeoutMs: step.timeoutSeconds > 0 ? step.timeoutSeconds * 1000 : undefined,
          metadata: { "trace-id": traceId }
        }
      );

      if (events.length > 0) {
        publishToolEvents(planId, step, traceId, events);
      } else {
        emitPlanEvent(planId, step, traceId, { state: "completed", summary: "Tool completed" });
      }

      if (events.some(event => TERMINAL_STATES.has(event.state))) {
        stepRegistry.delete(`${planId}:${step.id}`);
      }

      await message.ack();
    } catch (error) {
      const toolError =
        error instanceof ToolClientError
          ? error
          : new ToolClientError(error instanceof Error ? error.message : "Tool execution failed", {
              retryable: false,
              cause: error
            });

      if (toolError.retryable) {
        emitPlanEvent(planId, step, traceId, { state: "running", summary: `Retry scheduled: ${toolError.message}` });
        await message.retry();
        return;
      }

      emitPlanEvent(planId, step, traceId, { state: "failed", summary: toolError.message });
      stepRegistry.delete(`${planId}:${step.id}`);
      await message.ack();
    }
  });
}
