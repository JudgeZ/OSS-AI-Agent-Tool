import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearPlanHistory, getPlanHistory } from "./events.js";
import { createPlan } from "./planner.js";
import { parsePlan } from "./validation.js";

describe("planner", () => {
  const plansDir = path.join(process.cwd(), ".plans");

  beforeEach(() => {
    clearPlanHistory();
    fs.rmSync(plansDir, { recursive: true, force: true });
  });

  afterEach(() => {
    clearPlanHistory();
    fs.rmSync(plansDir, { recursive: true, force: true });
  });

  it("creates a validated plan with enriched metadata", () => {
    const plan = createPlan("Ship feature X");
    expect(plan.steps).not.toHaveLength(0);
    expect(() => parsePlan(plan)).not.toThrow();

    for (const step of plan.steps) {
      expect(step.tool).toBeTruthy();
      expect(step.capabilityLabel).toBeTruthy();
      expect(typeof step.timeoutSeconds).toBe("number");
    }

    const planPath = path.join(plansDir, plan.id, "plan.json");
    expect(fs.existsSync(planPath)).toBe(true);

    const events = getPlanHistory(plan.id);
    expect(events).toHaveLength(plan.steps.length);
    expect(events[0]?.step.capabilityLabel).toBe(plan.steps[0]?.capabilityLabel);
    expect(events.every(event => Boolean(event.occurredAt))).toBe(true);
  });
});
