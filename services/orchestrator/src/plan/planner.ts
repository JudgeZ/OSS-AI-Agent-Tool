import fs from "fs";
import path from "path";
import crypto from "crypto";

import { publishPlanStepEvent } from "./events.js";
import { startSpan } from "../observability/tracing.js";

export type PlanStep = {
  id: string;
  action: string;
  capability: string;
  timeout_s: number;
  approval: boolean;
};

export type Plan = {
  id: string;
  goal: string;
  steps: PlanStep[];
  success_criteria: string[];
};

export function createPlan(goal: string): Plan {
  const span = startSpan("planner.createPlan", { goal });
  try {
    const id = "plan-" + crypto.randomBytes(4).toString("hex");
    span.setAttribute("plan.id", id);
    const steps: PlanStep[] = [
      { id: "s1", action: "index_repo", capability: "repo.read", timeout_s: 300, approval: false },
      { id: "s2", action: "apply_changes", capability: "repo.write", timeout_s: 900, approval: true },
      { id: "s3", action: "run_tests", capability: "test.run", timeout_s: 900, approval: false },
      { id: "s4", action: "open_pr", capability: "github.write", timeout_s: 300, approval: true }
    ];
    const plan: Plan = {
      id,
      goal,
      steps,
      success_criteria: ["All tests pass", "CI green", "Docs updated"]
    };

    const dir = path.join(process.cwd(), ".plans", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
    fs.writeFileSync(
      path.join(dir, "plan.md"),
      `# Plan ${id}\n\nGoal: ${goal}\n\nSteps:\n- ` + plan.steps.map(step => step.action).join("\n- ")
    );

    for (const step of steps) {
      publishPlanStepEvent({
        event: "plan.step",
        traceId: span.context.traceId,
        planId: id,
        step: {
          id: step.id,
          state: "queued",
          capability: step.capability,
          timeout_s: step.timeout_s,
          approval: step.approval
        }
      });
    }

    return plan;
  } finally {
    span.end();
  }
}
