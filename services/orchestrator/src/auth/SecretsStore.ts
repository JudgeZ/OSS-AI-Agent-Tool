import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import https from "node:https";
import sodium from "libsodium-wrappers-sumo";

export interface SecretsStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

type LocalStoreOptions = {
  filePath?: string;
  passphrase?: string;
};

type PersistedPayload = {
  version: number;
  salt: string;
  nonce: string;
  cipher: string;
};

export class LocalFileStore implements SecretsStore {
  private cache: Map<string, string> = new Map();
  private ready: Promise<void>;
  private readonly filePath: string;
  private readonly passphrase: string;
  private salt?: Uint8Array;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options?: LocalStoreOptions) {
    const defaultPath = path.join(homedir(), ".oss-orchestrator", "secrets.json");
    this.filePath = options?.filePath ?? process.env.LOCAL_SECRETS_PATH ?? defaultPath;
    this.passphrase = options?.passphrase ?? process.env.LOCAL_SECRETS_PASSPHRASE ?? "";
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
    await sodium.ready;
    if (!this.passphrase) {
      throw new Error("LocalFileStore requires LOCAL_SECRETS_PASSPHRASE to be set");
    }
    await this.loadFromDisk();
  }

  private async loadFromDisk() {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const payload = JSON.parse(raw) as PersistedPayload;
      if (!payload.salt || !payload.nonce || !payload.cipher) {
        this.cache.clear();
        return;
      }
      const salt = sodium.from_base64(payload.salt, sodium.base64_variants.ORIGINAL);
      const key = this.deriveKey(salt);
      const nonce = sodium.from_base64(payload.nonce, sodium.base64_variants.ORIGINAL);
      const cipher = sodium.from_base64(payload.cipher, sodium.base64_variants.ORIGINAL);
      const decrypted = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
      if (!decrypted) {
        this.cache.clear();
        this.salt = salt;
        return;
      }
      const plaintext = sodium.to_string(decrypted);
      const parsed = JSON.parse(plaintext) as Record<string, string>;
      this.cache = new Map(Object.entries(parsed));
      this.salt = salt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        this.cache = new Map();
        this.salt = undefined;
        return;
      }
      throw error;
    }
  }

  private deriveKey(salt: Uint8Array) {
    return sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      this.passphrase,
      salt,
      sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      sodium.crypto_pwhash_MEMLIMIT_MODERATE,
      sodium.crypto_pwhash_ALG_DEFAULT
    );
  }

  private enqueuePersist(): Promise<void> {
    const run = this.persistChain.then(() => this.persist());
    this.persistChain = run.catch(() => {});
    return run;
  }

  private async persist() {
    const entries = Object.fromEntries(this.cache.entries());
    const plaintext = JSON.stringify(entries);
    const salt = this.salt ?? sodium.randombytes_buf(16);
    this.salt = salt;
    const key = this.deriveKey(salt);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const cipher = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
    const payload: PersistedPayload = {
      version: 1,
      salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
      nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
      cipher: sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL)
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload), { mode: 0o600 });
  }
}

// Placeholder for enterprise secret store (Vault / cloud)
// In production, replace with a proper backend.
export type VaultStoreOptions = {
  address?: string;
  token?: string;
  namespace?: string;
  mount?: string;
  prefix?: string;
  caCertPath?: string;
  tlsRejectUnauthorized?: boolean;
  fetchImpl?: typeof fetch;
};

export class VaultStoreError extends Error {
  constructor(message: string, readonly status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultStoreError";
  }
}

export class VaultStore implements SecretsStore {
  private readonly address: string;
  private readonly token: string;
  private readonly namespace?: string;
  private readonly mount: string;
  private readonly prefix: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tlsAgent?: https.Agent;

  constructor(options: VaultStoreOptions = {}) {
    this.address = (options.address ?? process.env.VAULT_ADDR)?.replace(/\/$/, "") ?? "";
    this.token = options.token ?? process.env.VAULT_TOKEN ?? "";
    this.namespace = options.namespace ?? process.env.VAULT_NAMESPACE;
    const mount = options.mount ?? process.env.VAULT_KV_MOUNT ?? "kv";
    this.mount = mount.replace(/^\/+|\/+$/g, "");
    const prefix = options.prefix ?? process.env.VAULT_SECRET_PREFIX ?? "oss/orchestrator";
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    const tlsRejectEnv = process.env.VAULT_TLS_REJECT_UNAUTHORIZED;
    const normalizedReject = tlsRejectEnv?.toLowerCase();
    const tlsReject =
      options.tlsRejectUnauthorized ??
      (normalizedReject != null ? normalizedReject !== "false" && normalizedReject !== "0" : true);
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.address) {
      throw new VaultStoreError("VaultStore requires VAULT_ADDR (or address option) to be set");
    }
    if (!this.token) {
      throw new VaultStoreError("VaultStore requires VAULT_TOKEN (or token option) to be set");
    }

    const caCertPath = options.caCertPath ?? process.env.VAULT_CA_CERT;
    if (caCertPath || tlsReject === false) {
      let ca: string | undefined;
      if (caCertPath) {
        try {
          ca = readFileSync(caCertPath, "utf-8");
        } catch (error) {
          throw new VaultStoreError(`Failed to read Vault CA certificate at ${caCertPath}`, undefined, {
            cause: error
          });
        }
      }
      this.tlsAgent = new https.Agent({
        ca,
        rejectUnauthorized: tlsReject
      });
    }
  }

  async get(key: string): Promise<string | undefined> {
    const url = this.buildUrl("data", key);
    const response = await this.request(url, { method: "GET" }, [200, 404]);
    if (response.status === 404) {
      return undefined;
    }
    const payload = (await response.json()) as {
      data?: { data?: Record<string, unknown> };
    };
    const value = payload?.data?.data?.value;
    return typeof value === "string" ? value : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    const url = this.buildUrl("data", key);
    await this.request(
      url,
      {
        method: "POST",
        body: JSON.stringify({ data: { value } })
      },
      [200, 204]
    );
  }

  async delete(key: string): Promise<void> {
    const url = this.buildUrl("metadata", key);
    await this.request(url, { method: "DELETE" }, [200, 204]);
  }

  private buildUrl(type: "data" | "metadata", key: string): URL {
    const pathFragment = this.buildPath(key);
    return new URL(`/v1/${this.mount}/${type}/${pathFragment}`, this.address);
  }

  private buildPath(key: string): string {
    const normalizedKey = key
      .split(":")
      .map(part => part.trim())
      .filter(Boolean)
      .map(segment => encodeURIComponent(segment))
      .join("/");
    const prefix = this.prefix ? `${this.prefix}/` : "";
    return `${prefix}${normalizedKey}`.replace(/\/+$/, "");
  }

  private async request(url: URL, init: RequestInit, okStatuses: number[]): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set("X-Vault-Token", this.token);
    if (this.namespace) {
      headers.set("X-Vault-Namespace", this.namespace);
    }
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const requestInit: RequestInit & { agent?: https.Agent } = {
      ...init,
      headers,
      agent: this.tlsAgent
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, requestInit);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new VaultStoreError(`Failed to reach Vault at ${this.address}: ${reason}`, undefined, {
        cause: error
      });
    }

    if (!okStatuses.includes(response.status)) {
      let detail: string | undefined;
      try {
        const body = (await response.clone().json()) as any;
        if (Array.isArray(body?.errors)) {
          detail = body.errors.join("; ");
        } else if (body?.error) {
          detail = String(body.error);
        } else if (typeof body === "string") {
          detail = body;
        }
      } catch {}
      const statusMessage = detail
        ? `${response.status} ${response.statusText} - ${detail}`
        : `${response.status} ${response.statusText}`;
      throw new VaultStoreError(`Vault request to ${url.pathname} failed: ${statusMessage}`, response.status);
    }

    return response;
  }
}
