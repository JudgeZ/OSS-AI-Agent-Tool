import { beforeEach, describe, expect, it, vi } from "vitest";

import { KafkaAdapter } from "./KafkaAdapter.js";
import {
  queueAckCounter,
  queueDeadLetterCounter,
  queueDepthGauge,
  queueRetryCounter,
  resetMetrics
} from "../observability/metrics.js";

import type { Admin, Consumer, EachMessagePayload, Kafka, Producer } from "kafkajs";
import type { MetricObjectWithValues, MetricValue } from "prom-client";

type EachMessageHandler = (payload: EachMessagePayload) => Promise<void>;

function createKafkaMocks() {
  let eachMessage: EachMessageHandler = async () => {};

  const producerSend = vi.fn().mockResolvedValue(undefined);
  const producer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: producerSend
  } as unknown as Producer;

  const commitOffsets = vi.fn().mockResolvedValue(undefined);
  const subscribe = vi.fn().mockResolvedValue(undefined);
  const consumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe,
    commitOffsets,
    run: vi.fn(async (config: { eachMessage: EachMessageHandler }) => {
      eachMessage = config.eachMessage;
    })
  } as unknown as Consumer;

  const fetchTopicOffsets = vi.fn().mockResolvedValue([{ partition: 0, offset: "0" }]);
  const fetchOffsets = vi.fn().mockResolvedValue([{ partition: 0, offset: "0" }]);
  const admin = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    fetchTopicOffsets,
    fetchOffsets
  } as unknown as Admin;

  const kafka = {
    producer: () => producer,
    consumer: () => consumer,
    admin: () => admin
  } as unknown as Kafka;

  return {
    kafka,
    producer,
    producerSend,
    consumer,
    commitOffsets,
    subscribe,
    admin,
    fetchTopicOffsets,
    fetchOffsets,
    getEachMessage: () => eachMessage,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
}

async function getMetricValue(
  metric: { get(): Promise<MetricObjectWithValues<MetricValue<string>>> },
  labels: Record<string, string>
): Promise<number> {
  const data = await metric.get();
  const match = data.values.find(entry =>
    Object.entries(labels).every(([key, value]) => entry.labels?.[key] === value)
  );
  return match ? Number(match.value) : 0;
}

function makeKafkaMessage(value: unknown, headers: Record<string, string> = {}, offset = "0") {
  return {
    value: Buffer.from(JSON.stringify(value)),
    headers: Object.entries(headers).reduce<Record<string, Buffer>>((acc, [key, val]) => {
      acc[key] = Buffer.from(val);
      return acc;
    }, {}),
    offset,
    key: headers["x-idempotency-key"] ? Buffer.from(headers["x-idempotency-key"]) : undefined
  };
}

describe("KafkaAdapter", () => {
  let adapter: KafkaAdapter;
  let mocks: ReturnType<typeof createKafkaMocks>;

  beforeEach(async () => {
    resetMetrics();
    mocks = createKafkaMocks();
    adapter = new KafkaAdapter({
      kafka: mocks.kafka,
      logger: mocks.logger,
      retryDelayMs: 0
    });
    await adapter.connect();
  });

  it("acknowledges messages and updates metrics", async () => {
    await adapter.consume("plan.steps", async message => {
      expect(message.payload).toEqual({ task: "index" });
      expect(message.attempts).toBe(0);
      await message.ack();
    });

    await adapter.enqueue("plan.steps", { task: "index" }, { idempotencyKey: "plan-1:s1" });

    const handler = mocks.getEachMessage();
    await handler({
      topic: "plan.steps",
      partition: 0,
      heartbeat: async () => {},
      pause: () => {},
      message: makeKafkaMessage({ task: "index" }, { "x-attempts": "0", "x-idempotency-key": "plan-1:s1" })
    });

    expect(mocks.commitOffsets).toHaveBeenCalledWith([
      { topic: "plan.steps", partition: 0, offset: "1" }
    ]);
    expect(mocks.producerSend).toHaveBeenCalledTimes(1);
    const ackMetric = await getMetricValue(queueAckCounter, { queue: "plan.steps" });
    expect(ackMetric).toBe(1);
  });

  it("retries messages with incremented attempts", async () => {
    await adapter.consume("plan.steps", async message => {
      if (message.attempts === 0) {
        await message.retry({ delayMs: 0 });
        return;
      }
      await message.ack();
    });

    await adapter.enqueue("plan.steps", { task: "apply" }, { idempotencyKey: "plan-1:s2" });

    const handler = mocks.getEachMessage();
    await handler({
      topic: "plan.steps",
      partition: 0,
      heartbeat: async () => {},
      pause: () => {},
      message: makeKafkaMessage(
        { task: "apply", job: { attempt: 0 } },
        { "x-attempts": "0", "x-idempotency-key": "plan-1:s2" }
      )
    });

    expect(mocks.producerSend).toHaveBeenCalledTimes(2);
    const [, retryCall] = mocks.producerSend.mock.calls;
    expect(retryCall[0]?.topic).toBe("plan.steps");
    const retryHeaders = retryCall[0]?.messages?.[0]?.headers;
    expect(retryHeaders?.["x-attempts"]).toEqual(Buffer.from("1"));
    const retryMetric = await getMetricValue(queueRetryCounter, { queue: "plan.steps" });
    expect(retryMetric).toBe(1);
  });

  it("routes dead-lettered messages to a .dead topic", async () => {
    await adapter.consume("plan.steps", async message => {
      await message.deadLetter({ reason: "validation" });
    });

    await adapter.enqueue("plan.steps", { task: "apply" }, { idempotencyKey: "plan-1:s3" });

    const handler = mocks.getEachMessage();
    await handler({
      topic: "plan.steps",
      partition: 0,
      heartbeat: async () => {},
      pause: () => {},
      message: makeKafkaMessage(
        { task: "apply" },
        { "x-attempts": "0", "x-idempotency-key": "plan-1:s3" }
      )
    });

    expect(mocks.producerSend).toHaveBeenCalledTimes(2);
    const deadCall = mocks.producerSend.mock.calls[1][0];
    expect(deadCall.topic).toBe("plan.steps.dead");
    const deadHeaders = deadCall.messages?.[0]?.headers;
    expect(deadHeaders?.["x-dead-letter-reason"]).toEqual(Buffer.from("validation"));
    const deadMetric = await getMetricValue(queueDeadLetterCounter, { queue: "plan.steps" });
    expect(deadMetric).toBe(1);
  });

  it("commits offsets when JSON parsing fails", async () => {
    await adapter.consume("plan.steps", async () => {
      throw new Error("should not be called");
    });

    const handler = mocks.getEachMessage();
    await handler({
      topic: "plan.steps",
      partition: 0,
      heartbeat: async () => {},
      pause: () => {},
      message: {
        value: Buffer.from("not-json"),
        headers: {},
        offset: "0"
      }
    });

    expect(mocks.commitOffsets).toHaveBeenCalledWith([
      { topic: "plan.steps", partition: 0, offset: "1" }
    ]);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse Kafka message")
    );
  });

  it("reports queue depth based on admin offsets", async () => {
    mocks.fetchTopicOffsets.mockResolvedValueOnce([
      { partition: 0, offset: "10" },
      { partition: 1, offset: "5" }
    ]);
    mocks.fetchOffsets.mockResolvedValueOnce([
      { partition: 0, offset: "7" },
      { partition: 1, offset: "5" }
    ]);

    const depth = await adapter.getQueueDepth("plan.steps");
    expect(depth).toBe(3);
  });
});

