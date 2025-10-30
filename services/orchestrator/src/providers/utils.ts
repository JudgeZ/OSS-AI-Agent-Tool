import { setTimeout as delay } from "node:timers/promises";

import type { SecretsStore } from "../auth/SecretsStore.js";

export type SecretLookup = {
  key: string;
  env?: string;
  description: string;
};

export class ProviderError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly details?: { provider: string; message: string; status?: number }[];
  override readonly cause?: unknown;

  constructor(message: string, options: {
    status?: number;
    code?: string;
    provider?: string;
    retryable?: boolean;
    cause?: unknown;
    details?: { provider: string; message: string; status?: number }[];
  } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status ?? 500;
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export async function requireSecret(
  store: SecretsStore,
  provider: string,
  lookup: SecretLookup
): Promise<string> {
  const fromStore = await store.get(lookup.key);
  const fromEnv = lookup.env ? process.env[lookup.env] : undefined;
  const value = fromStore ?? fromEnv;
  if (!value) {
    throw new ProviderError(
      `${provider} ${lookup.description} is not configured`,
      { status: 401, code: "missing_credentials", provider, retryable: false }
    );
  }
  return value;
}

export async function callWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelay = options.delayMs ?? 200;
  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError("Provider request failed", {
              status: 502,
              retryable: false,
              cause: error
            });
      lastError = providerError;
      if (!providerError.retryable || attempt === attempts - 1) {
        throw providerError;
      }
      await delay(baseDelay * (attempt + 1));
    }
  }
  throw lastError ?? new ProviderError("Provider request failed");
}

export function coalesceText(parts: Array<{ text?: string } | undefined>): string {
  return parts
    .map(part => part?.text ?? "")
    .join("")
    .trim();
}

export type BedrockBody = Uint8Array | Buffer | string | { transformToByteArray?: () => Promise<Uint8Array> } | null | undefined;

export async function decodeBedrockBody(body: BedrockBody): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf-8");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf-8");
  if (typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr).toString("utf-8");
  }
  return String(body);
}
