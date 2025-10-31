import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeadLetterOptions,
  EnqueueOptions,
  QueueAdapter,
  QueueHandler,
  QueueMessage,
  RetryOptions
} from "./QueueAdapter.js";

const publishPlanStepEventMock = vi.fn();

vi.mock("../plan/events.js", () => ({
  publishPlanStepEvent: publishPlanStepEventMock
}));

const executeToolMock = vi.fn();

vi.mock("../grpc/AgentClient.js", async () => {
  const actual = await vi.importActual<typeof import("../grpc/AgentClient.js")>("../grpc/AgentClient.js");
  return {
    ...actual,
    getToolAgentClient: vi.fn(() => ({ executeTool: executeToolMock })),
    resetToolAgentClient: vi.fn()
  };
});

vi.mock("./QueueAdapter.js", () => {
  return {
    getQueueAdapter: vi.fn(),
    createQueueAdapterFromConfig: vi.fn(),
    resetQueueAdapter: vi.fn()
  };
});

type InternalMessage<T> = {
  id: string;
  payload: T;
  headers: Record<string, string>;
  attempts: number;
  acked: boolean;
  inflight: boolean;
};

class InMemoryQueueAdapter implements QueueAdapter {
  private readonly queues = new Map<string, InternalMessage<any>[]>();
  private readonly consumers = new Map<string, QueueHandler<any>>();
  private sequence = 0;

  async connect(): Promise<void> {}

  async close(): Promise<void> {
    this.consumers.clear();
  }

  async enqueue<T>(queue: string, payload: T, options?: EnqueueOptions & { attempt?: number }): Promise<void> {
    const attempt = options?.attempt ?? 0;
    const headers: Record<string, string> = {
      ...(options?.headers ?? {}),
      "x-attempts": String(attempt)
    };
    if (options?.idempotencyKey) {
      headers["x-idempotency-key"] = options.idempotencyKey;
    }
    this.push(queue, payload, headers, attempt);
    await this.dispatch(queue);
  }

  async consume<T>(queue: string, handler: QueueHandler<T>): Promise<void> {
    this.consumers.set(queue, handler as QueueHandler<any>);
    await this.dispatch(queue);
  }

  async getQueueDepth(queue: string): Promise<number> {
    const entries = this.queues.get(queue) ?? [];
    return entries.filter(entry => !entry.acked).length;
  }

  send<T>(queue: string, payload: T, headers: Record<string, string> = {}, attempt = 0): void {
    this.push(queue, payload, headers, attempt);
    void this.dispatch(queue);
  }

  async flush(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
  }

  private push<T>(queue: string, payload: T, headers: Record<string, string>, attempt: number): void {
    const message: InternalMessage<T> = {
      id: headers["x-idempotency-key"] ?? `msg-${++this.sequence}`,
      payload,
      headers,
      attempts: attempt,
      acked: false,
      inflight: false
    };
    const list = this.queues.get(queue) ?? [];
    list.push(message);
    this.queues.set(queue, list);
  }

  private async dispatch(queue: string): Promise<void> {
    const handler = this.consumers.get(queue);
    if (!handler) {
      return;
    }
    const messages = this.queues.get(queue) ?? [];
    for (const entry of messages) {
      if (entry.acked || entry.inflight) {
        continue;
      }
      entry.inflight = true;
      const queueMessage: QueueMessage<any> = {
        id: entry.id,
        payload: entry.payload,
        headers: entry.headers,
        attempts: entry.attempts,
        ack: async () => {
          entry.acked = true;
          entry.inflight = false;
        },
        retry: async (options?: RetryOptions) => {
          entry.acked = true;
          entry.inflight = false;
          const nextAttempt = entry.attempts + 1;
          const headers = {
            ...entry.headers,
            "x-attempts": String(nextAttempt)
          };
          this.push(queue, entry.payload, headers, nextAttempt);
          await this.dispatch(queue);
        },
        deadLetter: async (options?: DeadLetterOptions) => {
          entry.acked = true;
          entry.inflight = false;
          const target = options?.queue ?? `${queue}.dead`;
          const headers = {
            ...entry.headers,
            "x-dead-letter-reason": options?.reason ?? "unspecified"
          };
          this.push(target, entry.payload, headers, entry.attempts);
          await this.dispatch(target);
        }
      };
      await handler(queueMessage);
    }
  }
}

describe("PlanQueueRuntime integration", () => {
  beforeEach(() => {
    vi.resetModules();
    publishPlanStepEventMock.mockReset();
    executeToolMock.mockReset();
    executeToolMock.mockResolvedValue([]);
  });

  it("rehydrates step metadata from queued tasks after restart", async () => {
    const adapter = new InMemoryQueueAdapter();
    const queueModule = await import("./QueueAdapter.js");
    queueModule.getQueueAdapter.mockResolvedValue(adapter);
    queueModule.createQueueAdapterFromConfig.mockReturnValue(adapter);

    const runtime = await import("./PlanQueueRuntime.js");
    const { initializePlanQueueRuntime, PLAN_STEPS_QUEUE, PLAN_COMPLETIONS_QUEUE } = runtime;

    const planId = `plan-${randomUUID()}`;
    const traceId = `trace-${randomUUID()}`;
    const step = {
      id: "s1",
      action: "Index repository",
      tool: "repo_indexer",
      capability: "repo.read",
      capabilityLabel: "Read repository",
      labels: ["repo", "scan"],
      timeoutSeconds: 120,
      approvalRequired: false,
      input: { path: "." },
      metadata: {}
    };

    executeToolMock.mockResolvedValueOnce([
      {
        invocationId: `inv-${randomUUID()}`,
        planId,
        stepId: step.id,
        state: "running",
        summary: "tool still working",
        occurredAt: new Date().toISOString()
      }
    ]);

    await adapter.enqueue(
      PLAN_STEPS_QUEUE,
      { planId, step, traceId },
      { idempotencyKey: `${planId}:${step.id}`, headers: { "trace-id": traceId } }
    );

    await initializePlanQueueRuntime();
    await adapter.flush();

    expect(executeToolMock).toHaveBeenCalledTimes(1);

    publishPlanStepEventMock.mockClear();

    adapter.send(PLAN_COMPLETIONS_QUEUE, { planId, stepId: step.id, state: "completed" }, { "trace-id": traceId });
    await adapter.flush();

    expect(publishPlanStepEventMock).toHaveBeenCalledTimes(1);
    const completionEvent = publishPlanStepEventMock.mock.calls[0][0];
    expect(completionEvent.step).toMatchObject({
      id: step.id,
      capability: step.capability,
      capabilityLabel: step.capabilityLabel,
      tool: step.tool,
      labels: step.labels
    });
    expect(completionEvent.traceId).toBe(traceId);
    expect(completionEvent.planId).toBe(planId);
  });
});
