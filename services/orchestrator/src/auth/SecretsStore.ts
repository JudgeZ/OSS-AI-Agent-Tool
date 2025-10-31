import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Agent, type Dispatcher } from "undici";

import { LocalKeystore } from "./LocalKeystore.js";

export interface SecretsStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

type LocalStoreOptions = {
  filePath?: string;
  passphrase?: string;
};

export class LocalFileStore implements SecretsStore {
  private cache: Map<string, string> = new Map();
  private ready: Promise<void>;
  private readonly filePath: string;
  private readonly passphrase: string;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly keystore: LocalKeystore;

  constructor(options?: LocalStoreOptions) {
    const defaultPath = path.join(process.cwd(), "config", "secrets", "local", "secrets.json");
    this.filePath = options?.filePath ?? process.env.LOCAL_SECRETS_PATH ?? defaultPath;
    this.passphrase = options?.passphrase ?? process.env.LOCAL_SECRETS_PASSPHRASE ?? "";
    this.keystore = new LocalKeystore(this.filePath, this.passphrase);
    this.ready = this.initialize();
  }

  async get(key: string): Promise<string | undefined> {
    await this.ready;
    return this.cache.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.ready;
    this.cache.set(key, value);
    await this.enqueuePersist();
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    this.cache.delete(key);
    await this.enqueuePersist();
  }

  private async initialize() {
    if (!this.passphrase) {
      throw new Error("LocalFileStore requires LOCAL_SECRETS_PASSPHRASE to be set");
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const existing = await this.keystore.read();
    this.cache = new Map(Object.entries(existing));
  }

  private enqueuePersist(): Promise<void> {
    const run = this.persistChain.then(() => this.persist());
    this.persistChain = run.catch(() => {});
    return run;
  }

  private async persist() {
    const entries = Object.fromEntries(this.cache.entries());
    await this.keystore.write(entries);
  }
}

type VaultStoreOptions = {
  url?: string;
  token?: string;
  namespace?: string;
  kvMountPath?: string;
  caCert?: string;
  rejectUnauthorized?: boolean;
};

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "true" || trimmed === "1" || trimmed === "yes" || trimmed === "on") {
    return true;
  }
  if (trimmed === "false" || trimmed === "0" || trimmed === "no" || trimmed === "off") {
    return false;
  }
  return undefined;
}

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "/") {
    start += 1;
  }
  while (end > start && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(start, end);
}

function resolveCaCertificate(source: string | undefined): string | undefined {
  if (!source) {
    return undefined;
  }
  const candidate = source.trim();
  if (!candidate) {
    return undefined;
  }
  if (candidate.includes("-----BEGIN")) {
    return candidate;
  }
  if (existsSync(candidate)) {
    return readFileSync(candidate, "utf-8");
  }
  return candidate;
}

function toSecretPath(key: string): string {
  const segments: string[] = [];
  let current = "";
  for (const char of key) {
    if (char === ":" || char === "/") {
      if (current.length > 0) {
        segments.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    segments.push(current);
  }
  const encoded = segments
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .map(segment => encodeURIComponent(segment));
  if (encoded.length === 0) {
    throw new Error("Secret keys must contain at least one valid segment");
  }
  return encoded.join("/");
}

export class VaultStore implements SecretsStore {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly namespace?: string;
  private readonly mountPath: string;
  private readonly dispatcher?: Dispatcher;

  constructor(options: VaultStoreOptions = {}) {
    const url = (options.url ?? process.env.VAULT_ADDR ?? "").trim();
    if (!url) {
      throw new Error("VaultStore requires VAULT_ADDR to be set");
    }
    this.baseUrl = new URL(url);

    const token = (options.token ?? process.env.VAULT_TOKEN ?? "").trim();
    if (!token) {
      throw new Error("VaultStore requires VAULT_TOKEN to be set");
    }
    this.token = token;

    const namespace = (options.namespace ?? process.env.VAULT_NAMESPACE)?.trim();
    this.namespace = namespace && namespace.length > 0 ? namespace : undefined;

    const mountCandidate = options.kvMountPath ?? process.env.VAULT_KV_MOUNT ?? "secret";
    const normalizedMount = trimSlashes(mountCandidate);
    this.mountPath = normalizedMount.length > 0 ? normalizedMount : "secret";

    const caCert = resolveCaCertificate(options.caCert ?? process.env.VAULT_CA_CERT);
    const rejectUnauthorized =
      options.rejectUnauthorized ?? parseBoolean(process.env.VAULT_TLS_REJECT_UNAUTHORIZED);

    if (caCert || rejectUnauthorized !== undefined) {
      const agentOptions: ConstructorParameters<typeof Agent>[0] = {};
      agentOptions.connect = {};
      if (caCert) {
        agentOptions.connect.ca = caCert;
      }
      if (rejectUnauthorized !== undefined) {
        agentOptions.connect.rejectUnauthorized = rejectUnauthorized;
      }
      this.dispatcher = new Agent(agentOptions);
    }
  }

  private buildUrl(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("X-Vault-Token", this.token);
    if (this.namespace) {
      headers.set("X-Vault-Namespace", this.namespace);
    }
    const requestInit: RequestInit & { dispatcher?: Dispatcher } = {
      ...init,
      headers,
      dispatcher: this.dispatcher
    };
    return fetch(this.buildUrl(path), requestInit);
  }

  async get(key: string): Promise<string | undefined> {
    const secretPath = toSecretPath(key);
    const response = await this.request(`/v1/${this.mountPath}/data/${secretPath}`);
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`Vault request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: { data?: Record<string, unknown> };
    };
    const rawValue = payload?.data?.data?.value;
    return typeof rawValue === "string" ? rawValue : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    const secretPath = toSecretPath(key);
    const response = await this.request(`/v1/${this.mountPath}/data/${secretPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { value } })
    });
    if (!response.ok) {
      throw new Error(`Vault request failed with status ${response.status}`);
    }
  }

  async delete(key: string): Promise<void> {
    const secretPath = toSecretPath(key);
    const response = await this.request(`/v1/${this.mountPath}/metadata/${secretPath}`, {
      method: "DELETE"
    });
    if (response.status === 404) {
      return;
    }
    if (!response.ok) {
      throw new Error(`Vault request failed with status ${response.status}`);
    }
  }
}
