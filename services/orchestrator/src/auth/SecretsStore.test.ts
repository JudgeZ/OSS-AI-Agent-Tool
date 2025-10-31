import { describe, expect, test } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalFileStore, VaultStore, VaultStoreError } from "./SecretsStore.js";

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
  test("retrieves secrets via Vault KV v2", async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init: RequestInit = {}) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requests.push({ url, init });
      return new Response(
        JSON.stringify({ data: { data: { value: "vault-secret" } } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    };

    const store = new VaultStore({
      address: "https://vault.example:8200",
      token: "test-token",
      namespace: "root",
      fetchImpl: fetchMock
    });

    const value = await store.get("provider:openai:apiKey");
    expect(value).toBe("vault-secret");

    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe(
      "/v1/kv/data/oss/orchestrator/provider/openai/apiKey"
    );
    const headers = new Headers(requests[0].init.headers ?? {});
    expect(headers.get("X-Vault-Token")).toBe("test-token");
    expect(headers.get("X-Vault-Namespace")).toBe("root");
  });

  test("returns undefined for missing secrets", async () => {
    const fetchMock: typeof fetch = async () => new Response("", { status: 404 });
    const store = new VaultStore({
      address: "https://vault.example:8200",
      token: "test-token",
      fetchImpl: fetchMock
    });

    await expect(store.get("missing")).resolves.toBeUndefined();
  });

  test("writes and deletes secrets via Vault", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init: RequestInit = {}) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push({ url, init });
      if (init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 200 });
    };

    const store = new VaultStore({
      address: "https://vault.example:8200",
      token: "test-token",
      fetchImpl: fetchMock
    });

    await store.set("provider:anthropic:apiKey", "secret-value");
    await store.delete("provider:anthropic:apiKey");

    expect(calls).toHaveLength(2);
    const [setCall, deleteCall] = calls;
    expect(setCall.url.pathname).toBe(
      "/v1/kv/data/oss/orchestrator/provider/anthropic/apiKey"
    );
    expect(setCall.init.method).toBe("POST");
    expect(setCall.init.body).toBe(JSON.stringify({ data: { value: "secret-value" } }));

    expect(deleteCall.url.pathname).toBe(
      "/v1/kv/metadata/oss/orchestrator/provider/anthropic/apiKey"
    );
    expect(deleteCall.init.method).toBe("DELETE");
  });

  test("surfaces actionable errors when Vault is unreachable", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8200");
    };

    const store = new VaultStore({
      address: "https://vault.example:8200",
      token: "test-token",
      fetchImpl: fetchMock
    });

    const result = store.get("provider:openai:apiKey");
    await expect(result).rejects.toBeInstanceOf(VaultStoreError);
    await expect(result).rejects.toThrow(/Failed to reach Vault/);
  });
});
