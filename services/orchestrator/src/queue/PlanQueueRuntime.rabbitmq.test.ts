import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GenericContainer } from "testcontainers";
import { afterAll, describe, expect, it, vi, type Mock } from "vitest";

import { submitPlanSteps, resetPlanQueueRuntime } from "./PlanQueueRuntime.js";
import { resetQueueAdapter } from "./QueueAdapter.js";
import type { Plan } from "../plan/planner.js";
import * as events from "../plan/events.js";

const executeTool = vi.fn();

const policyMock = vi.hoisted(() => ({
  enforcePlanStep: vi.fn().mockResolvedValue({ allow: true, deny: [] })
})) as {
  enforcePlanStep: Mock<[unknown?], Promise<{ allow: boolean; deny: unknown[] }>>;
};

vi.mock("../policy/PolicyEnforcer.js", () => {
  return {
    getPolicyEnforcer: () => policyMock,
    PolicyViolationError: class extends Error {}
  };
});

vi.mock("../grpc/AgentClient.js", () => {
  return {
    getToolAgentClient: () => ({
      executeTool
    }),
    resetToolAgentClient: vi.fn()
  };
});

async function waitForCondition(condition: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

describe("PlanQueueRuntime (RabbitMQ integration)", () => {
  const publishSpy = vi.spyOn(events, "publishPlanStepEvent");

  afterAll(() => {
    publishSpy.mockRestore();
  });

  it("processes plan steps end-to-end using RabbitMQ", async () => {
    policyMock.enforcePlanStep.mockReset();
    policyMock.enforcePlanStep.mockResolvedValue({ allow: true, deny: [] });
    executeTool.mockReset();
    publishSpy.mockClear();

    let container: Awaited<ReturnType<GenericContainer["start"]>> | undefined;
    try {
      container = await new GenericContainer("rabbitmq:3.13-management")
        .withExposedPorts(5672)
        .start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Could not find a working container runtime")) {
        console.warn("Skipping RabbitMQ integration test because no container runtime is available");
        return;
      }
      throw error;
    }

    const mappedPort = container.getMappedPort(5672);
    const host = container.getHost();
    const previousUrl = process.env.RABBITMQ_URL;
    const previousPrefetch = process.env.RABBITMQ_PREFETCH;
    let tempDir: string | undefined;

    try {
      process.env.RABBITMQ_URL = `amqp://guest:guest@${host}:${mappedPort}`;
      process.env.RABBITMQ_PREFETCH = "1";

      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-state-rmq-"));
      process.env.PLAN_STATE_PATH = path.join(tempDir, "state.json");

      resetPlanQueueRuntime();
      resetQueueAdapter();

      const plan: Plan = {
        id: "plan-rabbitmq",
        goal: "Verify RabbitMQ integration",
        steps: [
          {
            id: "step-1",
            action: "Execute tool",
            capability: "test.run",
            capabilityLabel: "Run test",
            labels: [],
            tool: "testTool",
            timeoutSeconds: 5,
            approvalRequired: false,
            input: {},
            metadata: {}
          }
        ],
        successCriteria: ["completed"]
      };

      executeTool.mockResolvedValue([
        {
          invocationId: "inv-1",
          planId: plan.id,
          stepId: plan.steps[0]!.id,
          state: "completed",
          summary: "Tool finished",
          occurredAt: new Date().toISOString()
        }
      ]);

      await submitPlanSteps(plan, "trace-rabbitmq");

      await waitForCondition(() => executeTool.mock.calls.length > 0);
      await waitForCondition(() =>
        publishSpy.mock.calls.some(([event]) => event.step.id === plan.steps[0]!.id && event.step.state === "completed")
      );

      expect(executeTool).toHaveBeenCalledTimes(1);
      const [invocation] = executeTool.mock.calls[0] ?? [];
      expect(invocation).toMatchObject({
        planId: plan.id,
        stepId: plan.steps[0]!.id,
        tool: plan.steps[0]!.tool
      });
    } finally {
      process.env.RABBITMQ_URL = previousUrl;
      process.env.RABBITMQ_PREFETCH = previousPrefetch;
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      if (container) {
        await container.stop();
      }
    }
  });
});

