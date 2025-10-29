import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

export type AgentProfile = {
  name: string;
  role: string;
  capabilities: string[];
  approval_policy?: Record<string, string>;
  model?: { provider?: string; routing?: string; temperature?: number };
  constraints?: string[];
  body?: string;
};

export function loadAgentProfile(name: string): AgentProfile {
  const p = path.join(process.cwd(), "agents", name, "agent.md");
  const raw = fs.readFileSync(p, "utf-8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
  let meta: Record<string, unknown> = {};
  let body = raw;
  if (m) {
    const yaml = m[1];
    body = m[2];
    const parsed = parseYaml(yaml);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>;
    }
  }
  const capabilities = normalizeStringArray(meta.capabilities, ["repo.read"]);
  const approvalPolicy = normalizeStringRecord(meta.approval_policy);
  const model = normalizeModel(meta.model);
  const constraints = normalizeStringArray(meta.constraints, []);
  return {
    name: typeof meta.name === "string" ? meta.name : name,
    role: typeof meta.role === "string" ? meta.role : "Agent",
    capabilities,
    approval_policy: approvalPolicy,
    model,
    constraints,
    body,
  };
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    return [value];
  }
  return fallback;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }
  return {};
}

function normalizeModel(value: unknown): AgentProfile["model"] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const model: AgentProfile["model"] = {};
    if (typeof record.provider === "string") {
      model.provider = record.provider;
    }
    if (typeof record.routing === "string") {
      model.routing = record.routing;
    }
    const temperature = record.temperature;
    if (typeof temperature === "number") {
      model.temperature = temperature;
    } else if (typeof temperature === "string") {
      const parsed = Number(temperature);
      if (!Number.isNaN(parsed)) {
        model.temperature = parsed;
      }
    }
    return model;
  }
  return {};
}
