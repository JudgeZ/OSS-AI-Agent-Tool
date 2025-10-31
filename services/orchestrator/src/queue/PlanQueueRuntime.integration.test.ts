import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import amqplib from "amqplib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Plan } from "../plan/planner.js";
import type { ToolEvent } from "../plan/validation.js";

const storePath = path.join(os.tmpdir(), `plan-runtime-${process.pid}-${Date.now()}.json`);
process.env.PLAN_RUNTIME_STORE_PATH = storePath;
process.env.RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://guest:guest@127.0.0.1:5672";

vi.mock("../grpc/AgentClient.js", () => {
  const getToolAgentClient = vi.fn();
  const resetToolAgentClient = vi.fn();
  class MockToolClientError extends Error {
    readonly retryable: boolean;

    constructor(message: string, options: { retryable?: boolean } = {}) {
      super(message);
      this.name = "ToolClientError";
      this.retryable = options.retryable ?? false;
    }
  }
  return {
    getToolAgentClient,
    resetToolAgentClient,
    ToolClientError: MockToolClientError
  };
});

vi.mock("../plan/events.js", () => ({
  publishPlanStepEvent: vi.fn()
}));

const agentModule = await import("../grpc/AgentClient.js");
const eventsModule = await import("../plan/events.js");

const executeTool = vi.fn<[], Promise<ToolEvent[]>>();
(agentModule.getToolAgentClient as vi.Mock).mockReturnValue({ executeTool });
const publishPlanStepEvent = eventsModule.publishPlanStepEvent as unknown as vi.Mock;

const {
  initializePlanQueueRuntime,
  submitPlanSteps,
  resetPlanQueueRuntime,
  clearPlanRuntimeStateForTests,
  PLAN_STEPS_QUEUE,
  PLAN_COMPLETIONS_QUEUE
} = await import("./PlanQueueRuntime.js");
const { resetQueueAdapter, getQueueAdapter } = await import("./QueueAdapter.js");
const { queueDepthGauge, resetMetrics } = await import("../observability/metrics.js");

async function purgeQueue(queue: string): Promise<void> {
  const connection = await amqplib.connect(process.env.RABBITMQ_URL!);
  const channel = await connection.createChannel();
  try {
    await channel.deleteQueue(queue, { ifEmpty: false, ifUnused: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 404) {
      throw error;
    }
  } finally {
    await channel.close();
    await connection.close();
  }
}

async function ensureQueues(): Promise<void> {
  const connection = await amqplib.connect(process.env.RABBITMQ_URL!);
  const channel = await connection.createChannel();
  await channel.assertQueue(PLAN_STEPS_QUEUE, { durable: true });
  await channel.assertQueue(PLAN_COMPLETIONS_QUEUE, { durable: true });
  await channel.close();
  await connection.close();
}

async function waitForExpectation(
  assertion: () => void | Promise<void>,
  timeoutMs = 10_000,
  intervalMs = 50
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}

let rabbitAvailable = true;
try {
  await ensureQueues();
} catch (error) {
  rabbitAvailable = false;
  console.warn(
    `[PlanQueueRuntime.integration] RabbitMQ unavailable, skipping tests: ${(error as Error).message}`
  );
}

function buildPlan(): Plan {
  return {
    id: `plan-${randomUUID()}`,
    goal: "Integration resume test",
    steps: [
      {
        id: "s1",
        action: "apply_changes",
        capability: "repo.write",
        capabilityLabel: "Apply repository changes",
        labels: ["repo", "automation"],
        tool: "code_writer",
        timeoutSeconds: 60,
        approvalRequired: false,
        input: {},
        metadata: {}
      }
    ],
    successCriteria: ["Step executed"]
  };
}

const describeOrSkip = rabbitAvailable ? describe : describe.skip;

describeOrSkip("PlanQueueRuntime integration", () => {
  if (!rabbitAvailable) {
    return;
  }

  beforeEach(async () => {
    resetMetrics();
    queueDepthGauge.reset();
    publishPlanStepEvent.mockReset();
    executeTool.mockReset();
    await clearPlanRuntimeStateForTests();
    resetPlanQueueRuntime();
    resetQueueAdapter();
    await purgeQueue(PLAN_STEPS_QUEUE);
    await purgeQueue(PLAN_COMPLETIONS_QUEUE);
    await purgeQueue(`${PLAN_STEPS_QUEUE}.dead`);
    try {
      await fs.unlink(storePath);
    } catch {}
  });

  afterEach(async () => {
    const adapter = await getQueueAdapter().catch(() => undefined);
    if (adapter) {
      await adapter.close();
      resetQueueAdapter();
    }
  });

  afterAll(async () => {
    try {
      await fs.unlink(storePath);
    } catch {}
  });

  it("resumes inflight steps after a simulated orchestrator restart", async () => {
    const plan = buildPlan();
    const traceId = randomUUID();

    let resolveHanging: ((events: ToolEvent[]) => void) | undefined;
    executeTool.mockImplementationOnce(
      () =>
        new Promise<ToolEvent[]>(resolve => {
          resolveHanging = resolve;
        })
    );

    await submitPlanSteps(plan, traceId);

    await waitForExpectation(() => {
      expect(executeTool).toHaveBeenCalledTimes(1);
    });

    const adapter = await getQueueAdapter();
    await adapter.close();
    resetQueueAdapter();
    resetPlanQueueRuntime();

    const completionEvent: ToolEvent = {
      invocationId: `inv-${randomUUID()}`,
      planId: plan.id,
      stepId: plan.steps[0].id,
      state: "completed",
      summary: "resumed successfully",
      occurredAt: new Date().toISOString()
    };

    executeTool.mockReset();
    executeTool.mockResolvedValueOnce([completionEvent]);

    await initializePlanQueueRuntime();

    await waitForExpectation(() => {
      expect(executeTool).toHaveBeenCalledTimes(1);
    });

    await waitForExpectation(async () => {
      const depth = await (await getQueueAdapter()).getQueueDepth(PLAN_STEPS_QUEUE);
      expect(depth).toBe(0);
    });

    await waitForExpectation(() => {
      expect(publishPlanStepEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: plan.id,
          step: expect.objectContaining({ id: plan.steps[0].id, state: "completed" })
        })
      );
    });

    resolveHanging?.([]);
  });
});
