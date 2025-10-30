import { randomUUID } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

export type SpanContext = {
  traceId: string;
  spanId: string;
};

export type Span = {
  name: string;
  context: SpanContext;
  attributes: Record<string, unknown>;
  setAttribute: (key: string, value: unknown) => void;
  addEvent: (name: string, attributes?: Record<string, unknown>) => void;
  recordException: (error: Error) => void;
  end: () => void;
};

function log(level: LogLevel, message: string, payload?: Record<string, unknown>): void {
  const entry = { level, message, ...payload };
  const emitter =
    level === "debug"
      ? console.log
      : level === "info"
        ? console.info
        : level === "warn"
          ? console.warn
          : console.error;
  emitter("[trace]", JSON.stringify(entry));
}

export function startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
  const context: SpanContext = { traceId: randomUUID(), spanId: randomUUID() };
  const span: Span = {
    name,
    context,
    attributes: { ...attributes },
    setAttribute: (key, value) => {
      span.attributes[key] = value;
    },
    addEvent: (eventName, eventAttributes) => {
      log("debug", `${name} event:${eventName}`, {
        traceId: context.traceId,
        spanId: context.spanId,
        ...eventAttributes
      });
    },
    recordException: error => {
      log("error", `${name} exception`, {
        traceId: context.traceId,
        spanId: context.spanId,
        error: error.message
      });
    },
    end: () => {
      log("info", `${name} complete`, {
        traceId: context.traceId,
        spanId: context.spanId,
        attributes: span.attributes
      });
    }
  };
  log("info", `${name} start`, { traceId: context.traceId, spanId: context.spanId, attributes });
  return span;
}

export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T> | T, attributes: Record<string, unknown> = {}): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    return await fn(span);
  } catch (error) {
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}
