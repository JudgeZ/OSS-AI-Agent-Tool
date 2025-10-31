import { randomUUID } from "node:crypto";

import { queueDepthGauge } from "../observability/metrics.js";
import { publishPlanStepEvent } from "../plan/events.js";
import type { Plan, PlanStep } from "../plan/planner.js";
import { getToolAgentClient, resetToolAgentClient, ToolClientError } from "../grpc/AgentClient.js";
import type { ToolEvent } from "../plan/validation.js";
import { getQueueAdapter } from "./QueueAdapter.js";
import { createPlanStateStore, type PlanStateStore } from "./PlanStateStore.js";

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
let planStateStore: PlanStateStore | null = createPlanStateStore();
let initialized: Promise<void> | null = null;

const TERMINAL_STATES = new Set<ToolEvent["state"]>(["completed", "failed"]);

export async function persistPlanStepState(
  planId: string,
  stepId: string,
  state: ToolEvent["state"],
  summary?: string,
  output?: Record<string, unknown>
): Promise<void> {
  await planStateStore?.setState(planId, stepId, state, summary, output);
}

async function emitPlanEvent(
  planId: string,
  step: PlanStep,
  traceId: string,
  update: Partial<ToolEvent> & { state: ToolEvent["state"]; summary?: string; output?: Record<string, unknown> }
): Promise<void> {
  await planStateStore?.setState(planId, step.id, update.state, update.summary, update.output);
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
      summary: update.summary ?? undefined,
      output: update.output as Record<string, unknown> | undefined
    }
  });
}

async function publishToolEvents(planId: string, baseStep: PlanStep, traceId: string, events: ToolEvent[]): Promise<void> {
  for (const event of events) {
    await emitPlanEvent(planId, baseStep, traceId, {
      state: event.state,
      summary: event.summary,
      occurredAt: event.occurredAt,
      output: event.output as Record<string, unknown> | undefined
    });
  }
}

export async function initializePlanQueueRuntime(): Promise<void> {
  if (!initialized) {
    initialized = Promise.all([setupStepConsumer(), setupCompletionConsumer(), rehydratePendingSteps()])
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
  planStateStore = createPlanStateStore();
}

export async function submitPlanSteps(plan: Plan, traceId: string): Promise<void> {
  await initializePlanQueueRuntime();
  const adapter = await getQueueAdapter();

  const submissions = plan.steps.map(async step => {
    const key = `${plan.id}:${step.id}`;
    stepRegistry.set(key, { step, traceId });
    await planStateStore?.rememberStep(plan.id, step, traceId);
    await emitPlanEvent(plan.id, step, traceId, {
      state: "queued",
      summary: "Queued for execution"
    });
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

    await planStateStore?.setState(payload.planId, payload.stepId, payload.state, payload.summary);
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
      await planStateStore?.forgetStep(payload.planId, payload.stepId);
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

    await emitPlanEvent(planId, step, traceId, { state: "running", summary: "Dispatching tool agent" });

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
        await publishToolEvents(planId, step, traceId, events);
      } else {
        await emitPlanEvent(planId, step, traceId, { state: "completed", summary: "Tool completed" });
      }

      if (events.some(event => TERMINAL_STATES.has(event.state))) {
        stepRegistry.delete(`${planId}:${step.id}`);
        await planStateStore?.forgetStep(planId, step.id);
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
        await emitPlanEvent(planId, step, traceId, { state: "running", summary: `Retry scheduled: ${toolError.message}` });
        await message.retry();
        return;
      }

      await emitPlanEvent(planId, step, traceId, { state: "failed", summary: toolError.message });
      stepRegistry.delete(`${planId}:${step.id}`);
      await planStateStore?.forgetStep(planId, step.id);
      await message.ack();
    }
  });
}

async function rehydratePendingSteps(): Promise<void> {
  const pending = await planStateStore?.listActiveSteps();
  if (!pending) {
    return;
  }
  for (const entry of pending) {
    const key = `${entry.planId}:${entry.stepId}`;
    stepRegistry.set(key, { step: entry.step, traceId: entry.traceId });
    publishPlanStepEvent({
      event: "plan.step",
      traceId: entry.traceId,
      planId: entry.planId,
      occurredAt: entry.updatedAt,
      step: {
        id: entry.stepId,
        action: entry.step.action,
        tool: entry.step.tool,
        state: entry.state,
        capability: entry.step.capability,
        capabilityLabel: entry.step.capabilityLabel,
        labels: entry.step.labels,
        timeoutSeconds: entry.step.timeoutSeconds,
        approvalRequired: entry.step.approvalRequired,
        summary: entry.summary,
        output: entry.output as Record<string, unknown> | undefined
      }
    });
  }
}
