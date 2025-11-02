import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanStep } from "../plan/planner.js";

const evaluateMock = vi.fn<
  [unknown],
  Array<{ result: { allow?: boolean; deny?: unknown[] } }>
>();
const setDataMock = vi.fn();

const loadPolicyMock = vi.fn(async () => ({
  evaluate: evaluateMock,
  setData: setDataMock
}));

vi.mock("@open-policy-agent/opa-wasm", () => ({
  loadPolicy: loadPolicyMock
}));

const loadAgentProfileMock = vi.fn();

vi.mock("../agents/AgentLoader.js", () => ({
  loadAgentProfile: loadAgentProfileMock
}));

describe("PolicyEnforcer", () => {
  let tempDir: string;
  let wasmPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "policy-enforcer-"));
    wasmPath = path.join(tempDir, "capabilities.wasm");
    writeFileSync(wasmPath, Buffer.from("wasm"));
    process.env.OPA_POLICY_WASM_PATH = wasmPath;

    evaluateMock.mockReset();
    evaluateMock.mockImplementation(() => [{ result: { allow: true, deny: [] } }]);
    setDataMock.mockReset();
    loadPolicyMock.mockClear();
    loadAgentProfileMock.mockReset();

    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPA_POLICY_WASM_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function createEnforcer() {
    const module = await import("./PolicyEnforcer.js");
    const { PolicyEnforcer } = module;
    return new PolicyEnforcer();
  }

  function buildStep(partial?: Partial<PlanStep>): PlanStep {
    return {
      id: "s1",
      action: "apply_changes",
      capability: "repo.write",
      capabilityLabel: "Apply repository changes",
      labels: ["repo"],
      tool: "code_writer",
      timeoutSeconds: 60,
      approvalRequired: false,
      input: {},
      metadata: {},
      ...partial
    } satisfies PlanStep;
  }

  it("evaluates plan step capabilities through OPA", async () => {
    loadAgentProfileMock.mockReturnValue({
      name: "code-writer",
      role: "Code Writer",
      capabilities: ["repo.read", "repo.write"],
      approval_policy: {},
      constraints: [],
      body: ""
    });

    let receivedInput: unknown;
    evaluateMock.mockImplementation(input => {
      receivedInput = input;
      return [{ result: { allow: true, deny: [] } }];
    });

    const enforcer = await createEnforcer();
    const step = buildStep();

    const decision = await enforcer.enforcePlanStep(step, {
      planId: "plan-123",
      traceId: "trace-abc",
      approvals: { "repo.write": true }
    });

    expect(decision.allow).toBe(true);
    expect(receivedInput.subject.capabilities).toContain("repo.write");
    expect(receivedInput.action.capabilities).toEqual(["repo.write"]);
    expect(loadPolicyMock).toHaveBeenCalledTimes(1);
  });

  it("returns deny reasons from the policy", async () => {
    loadAgentProfileMock.mockReturnValue({
      name: "code-writer",
      role: "Code Writer",
      capabilities: ["repo.read", "repo.write"],
      approval_policy: {},
      constraints: [],
      body: ""
    });

    evaluateMock.mockImplementation(() => [
      {
        result: {
          allow: false,
          deny: [{ reason: "missing_capability", capability: "repo.write" }]
        }
      }
    ]);

    const enforcer = await createEnforcer();
    const decision = await enforcer.enforcePlanStep(buildStep(), {
      planId: "plan-deny",
      traceId: "trace-deny"
    });

    expect(decision.allow).toBe(false);
    expect(decision.deny).toEqual([{ reason: "missing_capability", capability: "repo.write" }]);
  });

  it("falls back to step capability when agent profile is missing", async () => {
    loadAgentProfileMock.mockImplementation(() => {
      throw new Error("missing profile");
    });

    let receivedInput: unknown;
    evaluateMock.mockImplementation(input => {
      receivedInput = input;
      return [{ result: { allow: true, deny: [] } }];
    });

    const enforcer = await createEnforcer();
    await enforcer.enforcePlanStep(buildStep(), {
      planId: "plan-fallback",
      traceId: "trace-fallback"
    });

    expect(receivedInput.subject.agent).toBe("code-writer");
    expect(receivedInput.subject.capabilities).toEqual(["repo.write"]);
  });

  it("loads the policy once and reuses it", async () => {
    loadAgentProfileMock.mockReturnValue({
      name: "code-writer",
      role: "Code Writer",
      capabilities: ["repo.read", "repo.write"],
      approval_policy: {},
      constraints: [],
      body: ""
    });

    const enforcer = await createEnforcer();
    await enforcer.enforcePlanStep(buildStep(), { planId: "plan-1" });
    await enforcer.enforcePlanStep(buildStep({ id: "s2" }), { planId: "plan-1" });

    expect(loadPolicyMock).toHaveBeenCalledTimes(1);
  });

  it("evaluates http actions with provided capabilities", async () => {
    loadAgentProfileMock.mockImplementation(name => ({
      name,
      role: "Planner",
      capabilities: ["plan.create"],
      approval_policy: {},
      constraints: [],
      body: ""
    }));

    let receivedInput: unknown;
    evaluateMock.mockImplementation(input => {
      receivedInput = input;
      return [{ result: { allow: true, deny: [] } }];
    });

    const enforcer = await createEnforcer();
    const decision = await enforcer.enforceHttpAction({
      action: "http.post.plan",
      requiredCapabilities: ["plan.create"],
      agent: "planner",
      traceId: "trace-http"
    });

    expect(decision.allow).toBe(true);
    expect(receivedInput.action.capabilities).toEqual(["plan.create"]);
    expect(receivedInput.subject.agent).toBe("planner");
  });
});

