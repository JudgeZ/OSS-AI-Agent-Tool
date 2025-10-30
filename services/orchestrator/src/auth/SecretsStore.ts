import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
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
export class VaultStore implements SecretsStore {
  async get(k: string) { return undefined; }
  async set(k: string, v: string) { /* no-op */ }
  async delete(k: string) { /* no-op */ }
}
