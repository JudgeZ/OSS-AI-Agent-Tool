import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent } from "undici";

import { LocalFileStore, VaultStore } from "./SecretsStore.js";

describe("LocalFileStore", () => {
  test("persists encrypted secrets to disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "secrets-store-"));
    const file = path.join(dir, "secrets.json");
    const passphrase = "test-passphrase";

    const store = new LocalFileStore({ filePath: file, passphrase });
    await store.set("alpha", "bravo");
    await store.set("token", "value");

    expect(await store.get("alpha")).toBe("bravo");

    const raw = await readFile(file, "utf-8");
    expect(raw).not.toContain("bravo");
    expect(raw).not.toContain("value");

    const reloaded = new LocalFileStore({ filePath: file, passphrase });
    expect(await reloaded.get("alpha")).toBe("bravo");
    expect(await reloaded.get("token")).toBe("value");

    await reloaded.delete("alpha");
    expect(await reloaded.get("alpha")).toBeUndefined();
  }, 15000);
});

describe("VaultStore", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  function resetEnvironment() {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    resetEnvironment();
  });

  afterEach(() => {
    resetEnvironment();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.unstubAllGlobals();
  });

  test("wires TLS overrides through undici dispatcher", async () => {
    process.env.VAULT_ADDR = "https://vault.example.com";
    process.env.VAULT_TOKEN = "token";
    process.env.VAULT_KV_MOUNT = "kv";
    process.env.VAULT_CA_CERT = "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { data: { value: "secret-value" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new VaultStore();
    const value = await store.get("provider:openai:apiKey");

    expect(value).toBe("secret-value");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://vault.example.com/v1/kv/data/provider/openai/apiKey");
    expect(init?.dispatcher).toBeInstanceOf(Agent);
  });

  test("returns undefined when vault returns 404", async () => {
    process.env.VAULT_ADDR = "https://vault.example.com";
    process.env.VAULT_TOKEN = "token";

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new VaultStore();
    const value = await store.get("missing:secret");

    expect(value).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/missing/secret",
      expect.objectContaining({ dispatcher: undefined })
    );
  });
});
