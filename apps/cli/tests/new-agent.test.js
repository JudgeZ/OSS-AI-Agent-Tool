const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const execFileAsync = promisify(execFile);

const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");
const agentsDir = path.join(repoRoot, "agents");

function cleanupAgent(name) {
  const targetDir = path.join(agentsDir, name);
  fs.rmSync(targetDir, { recursive: true, force: true });
  if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) {
    fs.rmdirSync(agentsDir);
  }
}

test("aidt new-agent scaffolds an agent profile", async () => {
  const agentName = "sample-agent";
  cleanupAgent(agentName);

  await execFileAsync("node", ["apps/cli/dist/index.js", "new-agent", agentName], { cwd: repoRoot });

  const agentPath = path.join(agentsDir, agentName, "agent.md");
  assert.ok(fs.existsSync(agentPath), `expected agent profile at ${agentPath}`);
  const contents = fs.readFileSync(agentPath, "utf8");
  assert.match(contents, new RegExp(`name: \"${agentName}\"`));

  cleanupAgent(agentName);
});

