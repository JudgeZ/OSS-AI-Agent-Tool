import fs from "fs";
import path from "path";

export type AgentProfile = {
  name: string;
  role: string;
  capabilities: string[];
  approval_policy?: Record<string,string>;
  model?: { provider?: string; routing?: string; temperature?: number };
  constraints?: string[];
  body?: string;
};

export function loadAgentProfile(name: string): AgentProfile {
  const p = path.join(process.cwd(), "agents", name, "agent.md");
  const raw = fs.readFileSync(p, "utf-8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
  let meta: any = {}; let body = raw;
  if (m) {
    const yaml = m[1];
    body = m[2];
    yaml.split("\n").forEach(line => {
      const kv = /^(\w+):\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2];
    });
  }
  return {
    name: meta.name || name,
    role: meta.role || "Agent",
    capabilities: (meta.capabilities ? [].concat(meta.capabilities) : ["repo.read"]),
    approval_policy: meta.approval_policy || {},
    model: meta.model || {},
    constraints: meta.constraints || [],
    body
  };
}
