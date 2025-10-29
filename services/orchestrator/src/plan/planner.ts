import fs from "fs";
import path from "path";
import crypto from "crypto";

export type Plan = {
  id: string;
  goal: string;
  steps: any[];
  success_criteria: string[];
};

export function createPlan(goal: string): Plan {
  const id = "plan-" + crypto.randomBytes(4).toString("hex");
  const plan: Plan = {
    id,
    goal,
    steps: [
      { id: "s1", action: "index_repo", capability: "repo.read", timeout_s: 300, approval: false },
      { id: "s2", action: "apply_changes", capability: "repo.write", timeout_s: 900, approval: true },
      { id: "s3", action: "run_tests", capability: "test.run", timeout_s: 900, approval: false },
      { id: "s4", action: "open_pr", capability: "github.write", timeout_s: 300, approval: true }
    ],
    success_criteria: ["All tests pass", "CI green", "Docs updated"]
  };
  const dir = path.join(process.cwd(), ".plans", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, "plan.md"), `# Plan ${id}\n\nGoal: ${goal}\n\nSteps:\n- ` + plan.steps.map(s => s.action).join("\n- "));
  return plan;
}
