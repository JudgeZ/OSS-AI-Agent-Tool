import { Counter, Gauge, register } from "prom-client";

export const QUEUE_DEPTH_NAME = "orchestrator_queue_depth";
export const QUEUE_RETRY_NAME = "orchestrator_queue_retries_total";

function getOrCreateGauge(): Gauge<string> {
  const existing = register.getSingleMetric(QUEUE_DEPTH_NAME) as Gauge<string> | undefined;
  if (existing) {
    return existing;
  }
  return new Gauge({
    name: QUEUE_DEPTH_NAME,
    help: "Number of messages waiting in orchestrator queues",
    labelNames: ["queue"]
  });
}

function getOrCreateRetryCounter(): Counter<string> {
  const existing = register.getSingleMetric(QUEUE_RETRY_NAME) as Counter<string> | undefined;
  if (existing) {
    return existing;
  }
  return new Counter({
    name: QUEUE_RETRY_NAME,
    help: "Total number of orchestrator queue retries",
    labelNames: ["queue"]
  });
}

export const queueDepthGauge = getOrCreateGauge();
export const queueRetryCounter = getOrCreateRetryCounter();

export function resetMetrics(): void {
  register.resetMetrics();
  queueDepthGauge.reset();
  queueRetryCounter.reset();
}
