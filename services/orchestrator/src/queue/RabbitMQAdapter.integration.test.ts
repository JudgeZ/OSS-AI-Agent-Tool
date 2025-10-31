import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { RabbitMQAdapter } from "./RabbitMQAdapter.js";

const shouldRun = Boolean(process.env.CI || process.env.RABBITMQ_URL);

describe.runIf(shouldRun)("RabbitMQAdapter integration", () => {
  const url = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";

  it(
    "redelivers unacknowledged messages after consumer restart",
    async () => {
      const queueName = `plan.steps.test.${randomUUID()}`;
      const messageKey = `${randomUUID()}:step`;

      const deliveries: Array<{ attempts: number; id: string }> = [];

      const firstAdapter = new RabbitMQAdapter({ url, prefetch: 1 });
      await firstAdapter.connect();

      const completion = new Promise<void>((resolve, reject) => {
        firstAdapter
          .consume(queueName, async message => {
            try {
              deliveries.push({ attempts: message.attempts, id: message.id });
              if (deliveries.length === 1) {
                await firstAdapter.close();

                const secondAdapter = new RabbitMQAdapter({ url, prefetch: 1 });
                await secondAdapter.connect();
                await secondAdapter.consume(queueName, async retryMessage => {
                  try {
                    deliveries.push({ attempts: retryMessage.attempts, id: retryMessage.id });
                    await retryMessage.ack();
                    await secondAdapter.close();
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                });
              }
            } catch (error) {
              reject(error);
            }
          })
          .catch(reject);
      });

      await firstAdapter.enqueue(queueName, { task: "index" }, { idempotencyKey: messageKey });
      await completion;

      expect(deliveries.length).toBe(2);
      expect(new Set(deliveries.map(entry => entry.id)).size).toBe(1);
    },
    20_000
  );
});
