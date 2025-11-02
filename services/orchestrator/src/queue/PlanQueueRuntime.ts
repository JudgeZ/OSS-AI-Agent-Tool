import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";

import { queueDepthGauge, queueProcessingHistogram, queueResultCounter } from "../observability/metrics.js";
import { getLatestPlanStepEvent, publishPlanStepEvent } from "../plan/events.js";
import type { Plan, PlanStep } from "../plan/planner.js";
import { getToolAgentClient, resetToolAgentClient, ToolClientError } from "../grpc/AgentClient.js";
import type { PlanJob, ToolEvent } from "../plan/validation.js";
import { getQueueAdapter } from "./QueueAdapter.js";
import { createPlanStateStore, type PlanStateStore } from "./PlanStateStore.js";
import { withSpan } from "../observability/tracing.js";
import { getPolicyEnforcer, PolicyViolationError } from "../policy/PolicyEnforcer.js";

export const PLAN_STEPS_QUEUE = "plan.steps";
export const PLAN_COMPLETIONS_QUEUE = "plan.completions";

export type PlanStepTaskPayload = PlanJob;

export type PlanStepCompletionPayload = {
  planId: string;
  stepId: string;
  state: ToolEvent["state"];
  summary?: string;
  capability?: string;
  capabilityLabel?: string;
  labels?: string[];
  tool?: string;
  timeoutSeconds?: number;
  approvalRequired?: boolean;
  traceId?: string;
  occurredAt?: string;
  attempt?: number;
};

const DEFAULT_MAX_RETRIES = 5;

const stepRegistry = new Map<string, { step: PlanStep; traceId: string; job: PlanJob }>();
const approvalCache = new Map<string, Record<string, boolean>>();
const policyEnforcer = getPolicyEnforcer();
let planStateStore: PlanStateStore | null = createPlanStateStore();
let initialized: Promise<void> | null = null;

const TERMINAL_STATES = new Set<ToolEvent["state"]>(["completed", "failed", "dead_lettered", "rejected"]);

function parseIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const MAX_RETRIES = parseIntEnv("QUEUE_RETRY_MAX") ?? DEFAULT_MAX_RETRIES;

function computeRetryDelayMs(attempt: number): number | undefined {
  const base = parseIntEnv("QUEUE_RETRY_BACKOFF_MS");
  if (base === undefined || base <= 0) {
    return undefined;
  }
  const normalizedAttempt = Math.max(0, attempt);
  const multiplier = 2 ** normalizedAttempt;
  const rawDelay = base * multiplier;
  if (!Number.isFinite(rawDelay)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.min(rawDelay, Number.MAX_SAFE_INTEGER);
}

function approvalKey(planId: string, stepId: string): string {
  return `${planId}:${stepId}`;
}

async function ensureApprovals(planId: string, stepId: string): Promise<Record<string, boolean>> {
  const key = approvalKey(planId, stepId);
  const cached = approvalCache.get(key);
  if (cached) {
    return cached;
  }
  const persisted = await planStateStore?.getEntry(planId, stepId);
  const approvals = persisted?.approvals ? { ...persisted.approvals } : {};
  approvalCache.set(key, approvals);
  return approvals;
}

function cacheApprovals(planId: string, stepId: string, approvals: Record<string, boolean>): void {
  approvalCache.set(approvalKey(planId, stepId), { ...approvals });
}

function clearApprovals(planId: string, stepId: string): void {
  approvalCache.delete(approvalKey(planId, stepId));
}

export async function persistPlanStepState(
  planId: string,
  stepId: string,
  state: ToolEvent["state"],
  summary?: string,
  output?: Record<string, unknown>,
  attempt?: number
): Promise<void> {
  await planStateStore?.setState(planId, stepId, state, summary, output, attempt);
}

async function emitPlanEvent(
  planId: string,
  step: PlanStep,
  traceId: string,
  update: Partial<ToolEvent> & {
    state: ToolEvent["state"];
    summary?: string;
    output?: Record<string, unknown>;
    attempt?: number;
  }
): Promise<void> {
  await planStateStore?.setState(planId, step.id, update.state, update.summary, update.output, update.attempt);
  const latest = getLatestPlanStepEvent(planId, step.id);
  if (latest && latest.step.state === update.state) {
    const summariesMatch =
      update.summary === undefined
        ? latest.step.summary === undefined
        : latest.step.summary === update.summary;
    const outputsMatch =
      update.output === undefined
        ? latest.step.output === undefined
        : isDeepStrictEqual(latest.step.output, update.output);
    const occurredAtDiffers =
      update.occurredAt !== undefined && latest.occurredAt !== update.occurredAt;
    if (summariesMatch && outputsMatch && !occurredAtDiffers) {
      return;
    }
  }
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
      attempt: update.attempt,
      summary: update.summary ?? undefined,
      output: update.output as Record<string, unknown> | undefined
    }
  });
}

async function publishToolEvents(
  planId: string,
  baseStep: PlanStep,
  traceId: string,
  job: PlanJob,
  events: ToolEvent[]
): Promise<void> {
  for (const event of events) {
    await emitPlanEvent(planId, baseStep, traceId, {
      state: event.state,
      summary: event.summary,
      occurredAt: event.occurredAt,
      output: event.output as Record<string, unknown> | undefined,
      attempt: job.attempt
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
  approvalCache.clear();
  resetToolAgentClient();
  planStateStore = createPlanStateStore();
}

export async function submitPlanSteps(plan: Plan, traceId: string): Promise<void> {
  await initializePlanQueueRuntime();
  const adapter = await getQueueAdapter();

  const submissions = plan.steps.map(async step => {
    const key = `${plan.id}:${step.id}`;
    const job: PlanJob = {
      planId: plan.id,
      step,
      attempt: 0,
      createdAt: new Date().toISOString(),
      traceId
    };
    const approvals = await ensureApprovals(plan.id, step.id);
    const decision = await policyEnforcer.enforcePlanStep(step, {
      planId: plan.id,
      traceId,
      approvals
    });
    const blockingReasons = decision.deny.filter(reason => reason.reason !== "approval_required");
    if (!decision.allow && (blockingReasons.length > 0 || !step.approvalRequired)) {
      throw new PolicyViolationError(
        `Plan step ${step.id} for capability ${step.capability} is not permitted`,
        decision.deny
      );
    }

    stepRegistry.set(key, { step, traceId, job });
    const initialState = step.approvalRequired ? "waiting_approval" : "queued";
    await planStateStore?.rememberStep(plan.id, step, traceId, {
      initialState,
      idempotencyKey: key,
      attempt: job.attempt,
      createdAt: job.createdAt,
      approvals
    });
    if (step.approvalRequired) {
      await emitPlanEvent(plan.id, step, traceId, {
        state: "waiting_approval",
        summary: "Awaiting approval",
        attempt: job.attempt
      });
      return;
    }

    cacheApprovals(plan.id, step.id, approvals);

    try {
      await adapter.enqueue<PlanStepTaskPayload>(
        PLAN_STEPS_QUEUE,
        { ...job },
        {
          idempotencyKey: key,
          headers: { "trace-id": traceId }
        }
      );
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Failed to enqueue plan step";
      await emitPlanEvent(plan.id, step, traceId, {
        state: "failed",
        summary,
        attempt: job.attempt
      });
      throw error;
    }
    await emitPlanEvent(plan.id, step, traceId, {
      state: "queued",
      summary: "Queued for execution",
      attempt: job.attempt
    });
  });

  await Promise.all(submissions);
  const depth = await adapter.getQueueDepth(PLAN_STEPS_QUEUE);
  queueDepthGauge.labels(PLAN_STEPS_QUEUE).set(depth);
}

type ApprovalDecision = "approved" | "rejected";

export async function resolvePlanStepApproval(options: {
  planId: string;
  stepId: string;
  decision: ApprovalDecision;
  summary?: string;
}): Promise<void> {
  const { planId, stepId, decision, summary } = options;
  await initializePlanQueueRuntime();
  const key = `${planId}:${stepId}`;

  let metadata = stepRegistry.get(key);
  if (!metadata) {
    const persisted = await planStateStore?.getEntry(planId, stepId);
    if (persisted) {
      const job: PlanJob = {
        planId: persisted.planId,
        step: persisted.step,
        attempt: persisted.attempt,
        createdAt: persisted.createdAt,
        traceId: persisted.traceId
      };
      metadata = { step: persisted.step, traceId: persisted.traceId, job };
      stepRegistry.set(key, metadata);
    }
  }

  if (!metadata) {
    throw new Error(`Plan step ${planId}/${stepId} is not available`);
  }

  const { step, traceId, job } = metadata;
  const decisionSummary = summary ?? (decision === "approved" ? "Approved for execution" : "Step rejected");

  if (decision === "rejected") {
    await emitPlanEvent(planId, step, traceId, {
      state: "rejected",
      summary: decisionSummary,
      attempt: job.attempt
    });
    stepRegistry.delete(key);
    clearApprovals(planId, stepId);
    return;
  }

  const approvals = await ensureApprovals(planId, stepId);
  const updatedApprovals = { ...approvals, [step.capability]: true };
  const policyDecision = await policyEnforcer.enforcePlanStep(step, {
    planId,
    traceId,
    approvals: updatedApprovals
  });

  if (!policyDecision.allow) {
    throw new PolicyViolationError(
      `Approval denied by policy for plan ${planId} step ${stepId}`,
      policyDecision.deny
    );
  }

  cacheApprovals(planId, stepId, updatedApprovals);
  await planStateStore?.recordApproval(planId, stepId, step.capability, true);

  const adapter = await getQueueAdapter();

  await emitPlanEvent(planId, step, traceId, {
    state: "approved",
    summary: decisionSummary,
    attempt: job.attempt
  });
  const refreshedJob: PlanJob = {
    ...job,
    createdAt: new Date().toISOString()
  };
  metadata.job = refreshedJob;

  await adapter.enqueue<PlanStepTaskPayload>(
    PLAN_STEPS_QUEUE,
    { ...refreshedJob },
    {
      idempotencyKey: key,
      headers: { "trace-id": traceId }
    }
  );

  await emitPlanEvent(planId, step, traceId, {
    state: "queued",
    summary: decisionSummary,
    attempt: refreshedJob.attempt
  });

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
    const attempt =
      payload.attempt ??
      metadata?.job.attempt ??
      (await planStateStore?.getEntry(payload.planId, payload.stepId))?.attempt ??
      0;
    const traceId =
      payload.traceId ||
      metadata?.traceId ||
      message.headers["trace-id"] ||
      message.headers["traceId"] ||
      message.headers["Trace-Id"] ||
      "";

    await planStateStore?.setState(payload.planId, payload.stepId, payload.state, payload.summary, undefined, attempt);
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
        attempt,
        summary: payload.summary
      }
    });

    if (payload.state === "completed" || payload.state === "failed" || payload.state === "dead_lettered") {
      stepRegistry.delete(key);
      clearApprovals(payload.planId, payload.stepId);
      await planStateStore?.forgetStep(payload.planId, payload.stepId);
    }

    await message.ack();
  });
}

async function setupStepConsumer(): Promise<void> {
  const adapter = await getQueueAdapter();
  await adapter.consume<unknown>(PLAN_STEPS_QUEUE, async message => {
    let payload: PlanStepTaskPayload;
    try {
      payload = message.payload as PlanStepTaskPayload;
    } catch (error) {
      console.error("plan.step.invalid_payload", error);
      await message.ack();
      return;
    }

    const job: PlanJob = {
      ...payload,
      attempt: Math.max(payload.attempt ?? 0, message.attempts ?? 0)
    };
    const planId = job.planId;
    const step = payload.step;
    const traceId = job.traceId || message.headers["trace-id"] || message.id;
    const invocationId = randomUUID();
    const key = `${planId}:${step.id}`;

    await withSpan(
      "queue.plan_step.process",
      async span => {
        span.setAttribute("queue", PLAN_STEPS_QUEUE);
        span.setAttribute("plan.id", planId);
        span.setAttribute("plan.step_id", step.id);
        span.setAttribute("queue.attempt", job.attempt);
        span.setAttribute("trace.id", traceId);

        const entry = stepRegistry.get(key);
        if (entry) {
          entry.traceId = traceId;
          entry.job = job;
        } else {
          stepRegistry.set(key, { step, traceId, job });
        }

        const persisted = await planStateStore?.getEntry(planId, step.id);
        if (!persisted) {
          await planStateStore?.rememberStep(planId, step, traceId, {
            initialState: "running",
            idempotencyKey: key,
            attempt: job.attempt,
            createdAt: job.createdAt
          });
        }

        await emitPlanEvent(planId, step, traceId, {
          state: "running",
          summary: "Dispatching tool agent",
          attempt: job.attempt
        });

        const startedAt = performance.now();
        type QueueResult = "completed" | "failed" | "dead_lettered" | "retry" | "rejected";

        const recordResult = (result: QueueResult) => {
          const durationSeconds = (performance.now() - startedAt) / 1000;
          queueProcessingHistogram.labels(PLAN_STEPS_QUEUE).observe(durationSeconds);
          queueResultCounter.labels(PLAN_STEPS_QUEUE, result).inc();
          span.setAttribute("queue.result", result);
          span.setAttribute("queue.duration_ms", durationSeconds * 1000);
        };

        const approvals = await ensureApprovals(planId, step.id);
        const policyDecision = await policyEnforcer.enforcePlanStep(step, {
          planId,
          traceId,
          approvals
        });

        if (!policyDecision.allow) {
          const summary =
            policyDecision.deny.length > 0
              ? policyDecision.deny
                  .map(entry => (entry.capability ? `${entry.reason}:${entry.capability}` : entry.reason))
                  .join("; ")
              : "Capability policy denied execution";
          await emitPlanEvent(planId, step, traceId, {
            state: "rejected",
            summary,
            attempt: job.attempt
          });
          stepRegistry.delete(key);
          clearApprovals(planId, step.id);
          await planStateStore?.forgetStep(planId, step.id);
          await message.ack();
          recordResult("rejected");
          return;
        }

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
            await publishToolEvents(planId, step, traceId, job, events);
          } else {
            await emitPlanEvent(planId, step, traceId, {
              state: "completed",
              summary: "Tool completed",
              attempt: job.attempt
            });
          }

          const terminalEvent = [...events].reverse().find(event => TERMINAL_STATES.has(event.state));
          const terminalState = (terminalEvent?.state ?? "completed") as QueueResult;

          stepRegistry.delete(key);
          clearApprovals(planId, step.id);
          await planStateStore?.forgetStep(planId, step.id);

          await message.ack();
          recordResult(terminalState === "rejected" ? "rejected" : terminalState);
        } catch (error) {
          const toolError =
            error instanceof ToolClientError
              ? error
              : new ToolClientError(error instanceof Error ? error.message : "Tool execution failed", {
                  retryable: false,
                  cause: error
                });

          if (toolError.retryable && job.attempt < MAX_RETRIES) {
            await emitPlanEvent(planId, step, traceId, {
              state: "retrying",
              summary: `Retry scheduled (attempt ${job.attempt + 1}/${MAX_RETRIES}): ${toolError.message}`,
              attempt: job.attempt
            });
            const delayMs = computeRetryDelayMs(job.attempt);
            if (delayMs !== undefined) {
              await message.retry({ delayMs });
            } else {
              await message.retry();
            }
            const nextAttempt = job.attempt + 1;
            job.attempt = nextAttempt;
            await emitPlanEvent(planId, step, traceId, {
              state: "queued",
              summary: `Retry enqueued (attempt ${nextAttempt}/${MAX_RETRIES})`,
              attempt: nextAttempt
            });
            recordResult("retry");
            return;
          }

          if (toolError.retryable) {
            const reason = `Retries exhausted after ${job.attempt} attempts: ${toolError.message}`;
            await emitPlanEvent(planId, step, traceId, {
              state: "dead_lettered",
              summary: reason,
              attempt: job.attempt
            });
            await message.deadLetter({ reason });
            stepRegistry.delete(key);
            await planStateStore?.forgetStep(planId, step.id);
            recordResult("dead_lettered");
            return;
          }

          await emitPlanEvent(planId, step, traceId, {
            state: "failed",
            summary: toolError.message,
            attempt: job.attempt
          });
          stepRegistry.delete(key);
          clearApprovals(planId, step.id);
          await planStateStore?.forgetStep(planId, step.id);
          await message.ack();
          recordResult("failed");
        }
      },
      {
        queue: PLAN_STEPS_QUEUE,
        "plan.id": planId,
        "plan.step_id": step.id,
        traceId,
        attempt: job.attempt
      }
    );
  });
}

async function rehydratePendingSteps(): Promise<void> {
  const pending = await planStateStore?.listActiveSteps();
  if (!pending) {
    return;
  }
  for (const entry of pending) {
    const key = `${entry.planId}:${entry.stepId}`;
    const job: PlanJob = {
      planId: entry.planId,
      step: entry.step,
      attempt: entry.attempt,
      createdAt: entry.createdAt,
      traceId: entry.traceId
    };
    stepRegistry.set(key, { step: entry.step, traceId: entry.traceId, job });
    cacheApprovals(entry.planId, entry.stepId, entry.approvals ?? {});
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
        attempt: entry.attempt,
        summary: entry.summary,
        output: entry.output as Record<string, unknown> | undefined
      }
    });
  }
}
