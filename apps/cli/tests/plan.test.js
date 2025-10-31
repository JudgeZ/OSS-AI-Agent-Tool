const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const execFileAsync = promisify(execFile);

const cliRoot = path.resolve(__dirname, "..");
const plansDir = path.join(cliRoot, ".plans");

function resetPlansDir() {
  fs.rmSync(plansDir, { recursive: true, force: true });
}

test("aidt plan bundles orchestrator planner", async () => {
  resetPlansDir();
  const goal = "Verify planner bundle";
  const { stdout } = await execFileAsync("node", ["dist/index.js", "plan", goal], { cwd: cliRoot });
  assert.match(stdout, /Plan created: plan-[a-f0-9]+/);
  const match = stdout.match(/Plan created: (plan-[a-f0-9]+)/);
  assert.ok(match, "plan id should be present in stdout");
  const planId = match[1];

  const planJsonPath = path.join(plansDir, planId, "plan.json");
  assert.ok(fs.existsSync(planJsonPath), `expected plan.json at ${planJsonPath}`);
  const plan = JSON.parse(fs.readFileSync(planJsonPath, "utf8"));
  assert.equal(plan.goal, goal);
  assert.ok(Array.isArray(plan.steps) && plan.steps.length > 0, "plan should include steps");
});
