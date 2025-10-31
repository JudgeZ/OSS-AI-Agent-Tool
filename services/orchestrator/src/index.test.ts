import fs from "node:fs";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPlanHistory, getPlanHistory, publishPlanStepEvent } from "./plan/events.js";

vi.mock("./providers/ProviderRegistry.js", () => {
  return {
    routeChat: vi.fn().mockResolvedValue({ output: "hello", usage: { promptTokens: 5, completionTokens: 3 } })
  };
});

vi.mock("./queue/PlanQueueRuntime.js", () => {
  return {
    initializePlanQueueRuntime: vi.fn().mockResolvedValue(undefined),
    submitPlanSteps: vi.fn().mockResolvedValue(undefined),
    resolvePlanStepApproval: vi.fn().mockResolvedValue(undefined)
  };
});

describe("orchestrator http api", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    clearPlanHistory();
  });

  afterEach(() => {
    clearPlanHistory();
    fs.rmSync(path.join(process.cwd(), ".plans"), { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("creates a plan and exposes step events", async () => {
    const { createServer } = await import("./index.js");
    const app = createServer();

    const planResponse = await request(app).post("/plan").send({ goal: "Ship the next milestone" }).expect(201);

    expect(planResponse.body.plan).toBeDefined();
    expect(planResponse.body.plan.goal).toBe("Ship the next milestone");
    expect(planResponse.body.traceId).toBeTruthy();

    const { submitPlanSteps } = await import("./queue/PlanQueueRuntime.js");
    expect(submitPlanSteps).toHaveBeenCalledWith(expect.objectContaining({ id: planResponse.body.plan.id }), expect.any(String));

    const planId: string = planResponse.body.plan.id;

    const eventsResponse = await request(app)
      .get(`/plan/${planId}/events`)
      .set("Accept", "application/json")
      .expect(200);

    expect(eventsResponse.body.events).toHaveLength(planResponse.body.plan.steps.length);
    expect(eventsResponse.body.events[0].step.capability).toBeDefined();
  });

  describe("step approvals", () => {
    it("publishes approval events when a pending step is approved", async () => {
      const { createServer } = await import("./index.js");
      const app = createServer();

      const planResponse = await request(app).post("/plan").send({ goal: "Request approval" }).expect(201);
      const planId: string = planResponse.body.plan.id;
      const approvalStep = planResponse.body.plan.steps.find((step: { approvalRequired: boolean }) => step.approvalRequired);
      if (!approvalStep) {
        throw new Error("expected an approval-requiring step");
      }

      publishPlanStepEvent({
        event: "plan.step",
        traceId: "trace-approval",
        planId,
        step: {
          id: approvalStep.id,
          action: approvalStep.action,
          tool: approvalStep.tool,
          state: "waiting_approval",
          capability: approvalStep.capability,
          capabilityLabel: approvalStep.capabilityLabel,
          labels: approvalStep.labels,
          timeoutSeconds: approvalStep.timeoutSeconds,
          approvalRequired: true,
          summary: "Awaiting confirmation"
        }
      });

      await request(app)
        .post(`/plan/${planId}/steps/${approvalStep.id}/approve`)
        .send({ decision: "approve", rationale: "Looks good" })
        .expect(204);

      const { resolvePlanStepApproval } = await import("./queue/PlanQueueRuntime.js");
      expect(resolvePlanStepApproval).toHaveBeenCalledWith({
        planId,
        stepId: approvalStep.id,
        decision: "approved",
        summary: expect.stringContaining("Looks good")
      });
    });

    it("publishes rejection events when a pending step is rejected", async () => {
      const { createServer } = await import("./index.js");
      const app = createServer();

      const planResponse = await request(app).post("/plan").send({ goal: "Reject approval" }).expect(201);
      const planId: string = planResponse.body.plan.id;
      const approvalStep = planResponse.body.plan.steps.find((step: { approvalRequired: boolean }) => step.approvalRequired);
      if (!approvalStep) {
        throw new Error("expected an approval-requiring step");
      }

      publishPlanStepEvent({
        event: "plan.step",
        traceId: "trace-reject",
        planId,
        step: {
          id: approvalStep.id,
          action: approvalStep.action,
          tool: approvalStep.tool,
          state: "waiting_approval",
          capability: approvalStep.capability,
          capabilityLabel: approvalStep.capabilityLabel,
          labels: approvalStep.labels,
          timeoutSeconds: approvalStep.timeoutSeconds,
          approvalRequired: true,
          summary: "Pending"
        }
      });

      await request(app)
        .post(`/plan/${planId}/steps/${approvalStep.id}/approve`)
        .send({ decision: "reject", rationale: "Needs work" })
        .expect(204);

      const { resolvePlanStepApproval } = await import("./queue/PlanQueueRuntime.js");
      expect(resolvePlanStepApproval).toHaveBeenCalledWith({
        planId,
        stepId: approvalStep.id,
        decision: "rejected",
        summary: expect.stringContaining("Needs work")
      });
    });

    it("returns a conflict when the step is not awaiting approval", async () => {
      const { createServer } = await import("./index.js");
      const app = createServer();

      const planResponse = await request(app).post("/plan").send({ goal: "Invalid state" }).expect(201);
      const planId: string = planResponse.body.plan.id;
      const approvalStep = planResponse.body.plan.steps.find((step: { approvalRequired: boolean }) => step.approvalRequired);
      if (!approvalStep) {
        throw new Error("expected an approval-requiring step");
      }

      await request(app)
        .post(`/plan/${planId}/steps/${approvalStep.id}/approve`)
        .send({ decision: "approve" })
        .expect(409);
    });

    it("returns not found when the step has no history", async () => {
      const { createServer } = await import("./index.js");
      const app = createServer();

      const planResponse = await request(app).post("/plan").send({ goal: "Unknown step" }).expect(201);
      const planId: string = planResponse.body.plan.id;

      await request(app)
        .post(`/plan/${planId}/steps/does-not-exist/approve`)
        .send({ decision: "approve" })
        .expect(404);
    });
  });

  it("routes chat requests through the provider registry", async () => {
    const { createServer } = await import("./index.js");
    const app = createServer();

    const chatResponse = await request(app)
      .post("/chat")
      .send({ messages: [{ role: "user", content: "hi" }] })
      .expect(200);

    expect(chatResponse.body.traceId).toBeTruthy();
    expect(chatResponse.body.response.output).toBe("hello");

    const { routeChat } = await import("./providers/ProviderRegistry.js");
    expect(routeChat).toHaveBeenCalledWith({ messages: [{ role: "user", content: "hi" }] });
  });

  it("validates chat payloads", async () => {
    const { createServer } = await import("./index.js");
    const app = createServer();

    const invalidResponse = await request(app).post("/chat").send({}).expect(400);
    expect(invalidResponse.body.error).toContain("messages");
  });
});
