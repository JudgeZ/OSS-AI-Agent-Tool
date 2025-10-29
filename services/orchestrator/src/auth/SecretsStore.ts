export interface SecretsStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class LocalFileStore implements SecretsStore {
  private store: Map<string, string> = new Map();
  async get(k: string) { return this.store.get(k); }
  async set(k: string, v: string) { this.store.set(k, v); }
  async delete(k: string) { this.store.delete(k); }
}

// Placeholder for enterprise secret store (Vault / cloud)
// In production, replace with a proper backend.
export class VaultStore implements SecretsStore {
  async get(k: string) { return undefined; }
  async set(k: string, v: string) { /* no-op */ }
  async delete(k: string) { /* no-op */ }
}
