import amqplib, { type Channel, type Connection, type ConsumeMessage } from "amqplib";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { queueDepthGauge, queueRetryCounter } from "../observability/metrics.js";
import type {
  DeadLetterOptions,
  EnqueueOptions,
  QueueAdapter,
  QueueHandler,
  QueueMessage,
  RetryOptions
} from "./QueueAdapter.js";

const DEFAULT_RECONNECT_BASE_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_PREFETCH = 8;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return delay(ms);
}

type Logger = Pick<typeof console, "info" | "warn" | "error">;

type PublishOptions = EnqueueOptions & {
  attempt?: number;
  skipDedupe?: boolean;
};

type RabbitMQAdapterOptions = {
  url?: string;
  prefetch?: number;
  retryDelayMs?: number;
  reconnectBaseDelayMs?: number;
  amqplib?: typeof amqplib;
  logger?: Logger;
};

function normaliseHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    acc[key] = typeof value === "string" ? value : String(value);
    return acc;
  }, {});
}

export class RabbitMQAdapter implements QueueAdapter {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private connecting: Promise<void> | null = null;
  private readonly consumers = new Map<string, QueueHandler<any>>();
  private readonly inflightKeys = new Set<string>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;

  private readonly url: string;
  private readonly prefetch: number;
  private readonly retryDelayMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly amqp: typeof amqplib;
  private readonly logger: Logger;

  constructor(options: RabbitMQAdapterOptions = {}) {
    this.url = options.url ?? process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
    this.prefetch = options.prefetch ?? Number(process.env.RABBITMQ_PREFETCH ?? DEFAULT_PREFETCH);
    this.retryDelayMs = options.retryDelayMs ?? Number(process.env.RABBITMQ_RETRY_DELAY_MS ?? DEFAULT_RETRY_DELAY_MS);
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.amqp = options.amqplib ?? amqplib;
    this.logger = options.logger ?? console;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    if (this.connection) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.establishConnection();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async close(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const chan = this.channel;
    this.channel = null;
    if (chan) {
      try {
        await chan.close();
      } catch (error) {
        this.logger.warn?.(`RabbitMQ channel close failed: ${(error as Error).message}`);
      }
    }
    const conn = this.connection;
    this.connection = null;
    if (conn) {
      try {
        await conn.close();
      } catch (error) {
        this.logger.warn?.(`RabbitMQ connection close failed: ${(error as Error).message}`);
      }
    }
  }

  async enqueue<T>(queue: string, payload: T, options?: EnqueueOptions): Promise<void> {
    await this.publish(queue, payload, { ...options, attempt: 0 });
  }

  async consume<T>(queue: string, handler: QueueHandler<T>): Promise<void> {
    this.consumers.set(queue, handler as QueueHandler<any>);
    await this.setupConsumer(queue, handler);
  }

  async getQueueDepth(queue: string): Promise<number> {
    const channel = await this.ensureChannel();
    try {
      const result = await channel.checkQueue(queue);
      return typeof result.messageCount === "number" ? result.messageCount : 0;
    } catch (error) {
      this.logger.warn?.(`Failed to check queue depth for ${queue}: ${(error as Error).message}`);
      return 0;
    }
  }

  private async establishConnection(): Promise<void> {
    let attempt = 0;
    while (this.shouldReconnect && !this.connection) {
      try {
        const connection = await this.amqp.connect(this.url);
        this.connection = connection;
        connection.on("close", () => this.handleDisconnect());
        connection.on("error", error => this.handleDisconnect(error));
        this.channel = await connection.createChannel();
        await this.channel.prefetch(this.prefetch);
        for (const [queue, handler] of this.consumers.entries()) {
          await this.setupConsumer(queue, handler);
        }
        return;
      } catch (error) {
        attempt += 1;
        const delayMs = Math.min(this.reconnectBaseDelayMs * 2 ** (attempt - 1), MAX_RECONNECT_MS);
        this.logger.error?.(`RabbitMQ connection attempt ${attempt} failed: ${(error as Error).message}`);
        await sleep(delayMs);
      }
    }
  }

  private handleDisconnect(error?: unknown): void {
    if (!this.shouldReconnect) {
      return;
    }
    if (error) {
      this.logger.warn?.(`RabbitMQ connection closed: ${(error as Error).message}`);
    }
    this.connection = null;
    this.channel = null;
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(err => {
        this.logger.error?.(`RabbitMQ reconnect failed: ${(err as Error).message}`);
      });
    }, this.retryDelayMs);
    this.reconnectTimer.unref?.();
  }

  private async ensureChannel(): Promise<Channel> {
    if (!this.channel || !this.connection) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error("RabbitMQ channel unavailable");
    }
    return this.channel;
  }

  private async setupConsumer<T>(queue: string, handler: QueueHandler<T>): Promise<void> {
    const channel = await this.ensureChannel();
    await channel.assertQueue(queue, { durable: true });
    await channel.consume(
      queue,
      msg => this.handleMessage(queue, handler, msg),
      { noAck: false }
    );
  }

  private async handleMessage<T>(queue: string, handler: QueueHandler<T>, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      return;
    }
    const channel = await this.ensureChannel();
    const payload = JSON.parse(msg.content.toString()) as T;
    const headers = normaliseHeaders(msg.properties.headers);
    const attempts = Number(headers["x-attempts"] ?? 0);
    const idempotencyKey = headers["x-idempotency-key"];

    const queueMessage: QueueMessage<T> = {
      id: msg.properties.messageId || idempotencyKey || randomUUID(),
      payload,
      headers,
      attempts,
      ack: async () => {
        channel.ack(msg);
        if (idempotencyKey) {
          this.releaseKey(idempotencyKey);
        }
        await this.refreshDepth(queue);
      },
      retry: async (options?: RetryOptions) => {
        queueRetryCounter.labels(queue).inc();
        channel.ack(msg);
        await this.publish(queue, payload, {
          idempotencyKey,
          headers,
          attempt: attempts + 1,
          skipDedupe: true,
          delayMs: options?.delayMs ?? this.retryDelayMs
        });
        await this.refreshDepth(queue);
      },
      deadLetter: async (options?: DeadLetterOptions) => {
        channel.ack(msg);
        const reason = options?.reason ?? "unspecified";
        const targetQueue = options?.queue ?? `${queue}.dead`;
        await this.publish(targetQueue, payload, {
          headers: { ...headers, "x-dead-letter-reason": reason },
          skipDedupe: true
        });
        if (idempotencyKey) {
          this.releaseKey(idempotencyKey);
        }
        await this.refreshDepth(queue);
      }
    };

    try {
      await handler(queueMessage);
    } catch (error) {
      this.logger.error?.(`Queue handler for ${queue} failed: ${(error as Error).message}`);
      await queueMessage.retry();
    }
  }

  private async publish<T>(queue: string, payload: T, options: PublishOptions = {}): Promise<void> {
    const channel = await this.ensureChannel();
    await channel.assertQueue(queue, { durable: true });

    const { skipDedupe, attempt, delayMs, idempotencyKey, headers: headerOverrides } = options;

    if (delayMs && delayMs > 0) {
      await sleep(delayMs);
    }

    const headers: Record<string, string> = {
      ...headerOverrides,
      "x-attempts": String(attempt ?? 0)
    };
    if (idempotencyKey) {
      headers["x-idempotency-key"] = idempotencyKey;
      if (!skipDedupe && this.inflightKeys.has(idempotencyKey)) {
        return;
      }
      this.inflightKeys.add(idempotencyKey);
    }

    const messageId = idempotencyKey ?? randomUUID();
    const content = Buffer.from(JSON.stringify(payload));
    channel.sendToQueue(queue, content, {
      persistent: true,
      messageId,
      headers
    });

    await this.refreshDepth(queue);
  }

  private releaseKey(key: string): void {
    this.inflightKeys.delete(key);
  }

  private async refreshDepth(queue: string): Promise<void> {
    try {
      const depth = await this.getQueueDepth(queue);
      queueDepthGauge.labels(queue).set(depth);
    } catch (error) {
      this.logger.warn?.(`Failed to refresh depth for ${queue}: ${(error as Error).message}`);
    }
  }
}
