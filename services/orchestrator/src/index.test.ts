import fs from "node:fs";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPlanHistory } from "./plan/events.js";

vi.mock("./providers/ProviderRegistry.js", () => {
  return {
    routeChat: vi.fn().mockResolvedValue({ output: "hello", usage: { promptTokens: 5, completionTokens: 3 } })
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

    const planId: string = planResponse.body.plan.id;

    const eventsResponse = await request(app)
      .get(`/plan/${planId}/events`)
      .set("Accept", "application/json")
      .expect(200);

    expect(eventsResponse.body.events).toHaveLength(planResponse.body.plan.steps.length);
    expect(eventsResponse.body.events[0].step.capability).toBeDefined();
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
