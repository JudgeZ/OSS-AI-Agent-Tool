import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { RabbitMQAdapter } from "./RabbitMQAdapter.js";
import { queueDepthGauge, queueRetryCounter, resetMetrics } from "../observability/metrics.js";

import type { ConsumeMessage, Options } from "amqplib";

type StoredMessage = {
  queue: string;
  content: Buffer;
  options: Options.Publish;
  acked: boolean;
};

class MockChannel {
  private readonly consumers = new Map<string, (msg: ConsumeMessage | null) => void>();
  private readonly queues = new Map<string, StoredMessage[]>();
  private readonly deliveryMap = new WeakMap<ConsumeMessage, StoredMessage>();
  private deliveryTag = 0;

  async prefetch(): Promise<void> {
    // no-op for mock
  }

  async assertQueue(queue: string): Promise<void> {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }
  }

  async consume(queue: string, handler: (msg: ConsumeMessage | null) => void): Promise<{ consumerTag: string }> {
    this.consumers.set(queue, handler);
    return { consumerTag: `${queue}-consumer` };
  }

  async sendToQueue(queue: string, content: Buffer, options: Options.Publish): Promise<boolean> {
    const messages = this.queues.get(queue) ?? [];
    const stored: StoredMessage = { queue, content, options, acked: false };
    messages.push(stored);
    this.queues.set(queue, messages);

    const consumer = this.consumers.get(queue);
    if (consumer) {
      const msg = this.createMessage(queue, stored);
      queueMicrotask(() => consumer(msg));
    }

    return true;
  }

  async checkQueue(queue: string): Promise<{ messageCount: number; consumerCount: number }> {
    return {
      messageCount: this.getDepth(queue),
      consumerCount: this.consumers.has(queue) ? 1 : 0
    };
  }

  ack(msg: ConsumeMessage): void {
    const stored = this.deliveryMap.get(msg);
    if (stored) {
      stored.acked = true;
    }
  }

  async close(): Promise<void> {
    this.consumers.clear();
    this.queues.clear();
  }

  getDepth(queue: string): number {
    const messages = this.queues.get(queue) ?? [];
    return messages.filter(message => !message.acked).length;
  }

  getPublishedCount(queue: string): number {
    return (this.queues.get(queue) ?? []).length;
  }

  private createMessage(queue: string, stored: StoredMessage): ConsumeMessage {
    const properties = stored.options ?? {};
    const msg: ConsumeMessage = {
      content: stored.content,
      fields: {
        consumerTag: `${queue}-consumer`,
        deliveryTag: ++this.deliveryTag,
        redelivered: Boolean(properties.headers?.["x-attempts"] && Number(properties.headers?.["x-attempts"]) > 0),
        exchange: "",
        routingKey: queue
      },
      properties: {
        headers: properties.headers ?? {},
        messageId: properties.messageId ?? "",
        contentType: properties.contentType,
        deliveryMode: properties.persistent ? 2 : undefined
      }
    } as ConsumeMessage;
    this.deliveryMap.set(msg, stored);
    return msg;
  }
}

class MockConnection extends EventEmitter {
  constructor(private readonly channel: MockChannel) {
    super();
  }

  async createChannel(): Promise<MockChannel> {
    return this.channel;
  }

  async close(): Promise<void> {
    this.emit("close");
  }
}

async function getMetricValue(
  metric: {
    get(): Promise<{ values: Array<{ value: number; labels: Record<string, string> }> } | { values: Array<{ value: number; labels: Record<string, string> }> }>;
  },
  labels: Record<string, string>
): Promise<number> {
  const data = await metric.get();
  const values = Array.isArray((data as any).values) ? (data as any).values : [];
  const match = values.find(entry => {
    return Object.entries(labels).every(([key, value]) => entry.labels?.[key] === value);
  });
  return match ? match.value : 0;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe("RabbitMQAdapter", () => {
  let channel: MockChannel;
  let adapter: RabbitMQAdapter;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    resetMetrics();
    channel = new MockChannel();
    const connection = new MockConnection(channel);
    const mockAmqp = { connect: vi.fn().mockResolvedValue(connection) } as unknown as typeof import("amqplib");
    adapter = new RabbitMQAdapter({ amqplib: mockAmqp, logger });
    await adapter.connect();
  });

  it("acknowledges messages and updates queue depth", async () => {
    await adapter.consume("plan.steps", async message => {
      expect(message.payload).toEqual({ task: "index" });
      expect(message.attempts).toBe(0);
      await message.ack();
    });

    await adapter.enqueue("plan.steps", { task: "index" }, { idempotencyKey: "plan-1:s1" });

    await flushMicrotasks();

    expect(channel.getDepth("plan.steps")).toBe(0);
    const depthMetric = await getMetricValue(queueDepthGauge, { queue: "plan.steps" });
    expect(depthMetric).toBe(0);
  });

  it("retries messages when instructed", async () => {
    let seenAttempts: number[] = [];
    await adapter.consume("plan.steps", async message => {
      seenAttempts.push(message.attempts);
      if (message.attempts === 0) {
        await message.retry({ delayMs: 0 });
        return;
      }
      await message.ack();
    });

    await adapter.enqueue("plan.steps", { task: "apply" }, { idempotencyKey: "plan-1:s2" });

    await flushMicrotasks();
    await flushMicrotasks();

    expect(seenAttempts).toEqual([0, 1]);
    expect(channel.getPublishedCount("plan.steps")).toBe(2);
    const retryMetric = await getMetricValue(queueRetryCounter, { queue: "plan.steps" });
    expect(retryMetric).toBe(1);
  });

  it("routes failed messages to a dead-letter queue", async () => {
    await adapter.consume("plan.steps", async message => {
      await message.deadLetter({ reason: "validation" });
    });

    await adapter.enqueue("plan.steps", { task: "apply" }, { idempotencyKey: "plan-1:s3" });

    await flushMicrotasks();

    expect(channel.getDepth("plan.steps")).toBe(0);
    expect(channel.getPublishedCount("plan.steps.dead")).toBe(1);
  });
});
