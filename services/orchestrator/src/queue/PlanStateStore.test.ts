import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlanStateStore } from "./PlanStateStore.js";

const sampleStep = {
  id: "s1",
  action: "index_repo",
  capability: "repo.read",
  capabilityLabel: "Read repository",
  labels: ["repo"],
  tool: "repo_indexer",
  timeoutSeconds: 120,
  approvalRequired: false,
  input: {},
  metadata: {}
};

describe("PlanStateStore", () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "plan-state-"));
    storePath = path.join(dir, "state.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("persists queued steps and updates state", async () => {
    const store = new PlanStateStore({ filePath: storePath });
    await store.rememberStep("plan-1", sampleStep, "trace-1");
    await store.setState("plan-1", "s1", "running", "Dispatching", { diff: { files: [] } });

    const reloaded = new PlanStateStore({ filePath: storePath });
    const pending = await reloaded.listActiveSteps();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.state).toBe("running");
    expect(pending[0]?.summary).toBe("Dispatching");
    expect(pending[0]?.output).toEqual({ diff: { files: [] } });
  });

  it("clears terminal states", async () => {
    const store = new PlanStateStore({ filePath: storePath });
    await store.rememberStep("plan-1", sampleStep, "trace-1");
    await store.setState("plan-1", "s1", "completed", "Done");
    const remaining = await store.listActiveSteps();
    expect(remaining).toHaveLength(0);
  });

  it("forgets steps explicitly", async () => {
    const store = new PlanStateStore({ filePath: storePath });
    await store.rememberStep("plan-1", sampleStep, "trace-1");
    await store.forgetStep("plan-1", "s1");
    const pending = await store.listActiveSteps();
    expect(pending).toHaveLength(0);
  });
});
