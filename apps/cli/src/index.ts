#!/usr/bin/env node
import fs from "fs";
import path from "path";

function usage() {
  console.log(`oss-ai-agent-tool CLI
Usage:
  aidt new-agent <name>           Create agents/<name>/agent.md from template
  aidt plan <goal...>             Create a plan under .plans/
`);
}

async function newAgent(name: string) {
  const dir = path.join(process.cwd(), "agents", name);
  const file = path.join(dir, "agent.md");
  const templatePath = path.join(process.cwd(), "docs", "agents", "templates", "agent.md");
  if (!fs.existsSync(templatePath)) {
    console.error("Template not found:", templatePath);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  const tpl = fs.readFileSync(templatePath, "utf-8").replace('name: "code-writer"', `name: "${name}"`);
  fs.writeFileSync(file, tpl, "utf-8");
  console.log("Created", file);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "new-agent") {
    if (!rest[0]) return usage();
    await newAgent(rest[0]);
    return;
  }
  if (cmd === "plan") {
    const goal = rest.join(" ").trim() || "General improvement";
    const { createPlan } = await import("../../services/orchestrator/src/plan/planner.js");
    const plan = createPlan(goal);
    console.log(`Plan created: ${plan.id}`);
    console.log("Goal:", plan.goal);
    console.log("Steps:");
    for (const step of plan.steps) {
      const approvalText = step.approvalRequired ? "requires approval" : "auto";
      console.log(
        `  • ${step.action} (${step.capabilityLabel}) [tool=${step.tool}, timeout=${step.timeoutSeconds}s, ${approvalText}]`
      );
    }
    if (plan.successCriteria?.length) {
      console.log("Success criteria:");
      for (const criteria of plan.successCriteria) {
        console.log(`  - ${criteria}`);
      }
    }
    console.log(`SSE stream: /plan/${plan.id}/events`);
    return;
  }
  usage();
}

main().catch(e => { console.error(e); process.exit(1); });
