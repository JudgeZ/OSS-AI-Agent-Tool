import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAgentProfile } from "../AgentLoader";

const TEMPLATE_AGENT_NAME = "__template_agent__";
const TEMPLATE_SOURCE = findTemplateSource();
const TEMPLATE_DEST_DIR = path.join(process.cwd(), "agents", TEMPLATE_AGENT_NAME);
const TEMPLATE_DEST_FILE = path.join(TEMPLATE_DEST_DIR, "agent.md");

describe("loadAgentProfile", () => {
  beforeAll(() => {
    fs.mkdirSync(TEMPLATE_DEST_DIR, { recursive: true });
    const templateContents = fs.readFileSync(TEMPLATE_SOURCE, "utf-8");
    fs.writeFileSync(TEMPLATE_DEST_FILE, templateContents);
  });

  afterAll(() => {
    if (fs.existsSync(TEMPLATE_DEST_DIR)) {
      fs.rmSync(TEMPLATE_DEST_DIR, { recursive: true, force: true });
    }
    const agentsDir = path.dirname(TEMPLATE_DEST_DIR);
    if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) {
      fs.rmdirSync(agentsDir);
    }
  });

  it("parses multi-line YAML front matter fields", () => {
    const profile = loadAgentProfile(TEMPLATE_AGENT_NAME);

    expect(profile.name).toBe("code-writer");
    expect(profile.role).toBe("Code Writer");
    expect(profile.capabilities).toEqual([
      "repo.read",
      "repo.write",
      "test.run",
      "plan.read",
    ]);
    expect(profile.approval_policy).toEqual({
      "repo.write": "human_approval",
      "network.egress": "deny",
    });
    expect(profile.model).toEqual({
      provider: "auto",
      routing: "default",
      temperature: 0.2,
    });
    expect(profile.constraints).toEqual([
      "Prioritize reliability and test coverage over speed",
      "Never bypass security gates",
      "Capture diffs and test results in the plan timeline",
    ]);
    expect(profile.body).toContain("# Agent Guide");
  });
});

function findTemplateSource(): string {
  const candidateRoots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ];
  for (const root of candidateRoots) {
    const candidate = path.join(root, "docs", "agents", "templates", "agent.md");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Unable to locate docs/agents/templates/agent.md");
}
