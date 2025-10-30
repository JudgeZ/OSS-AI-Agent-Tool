import { describe, expect, test } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalFileStore } from "./SecretsStore.js";

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
