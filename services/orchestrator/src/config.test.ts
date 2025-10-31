import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

const ENV_KEYS = [
  "RUN_MODE",
  "MESSAGE_BUS",
  "MESSAGING_TYPE",
  "PROVIDERS",
  "OAUTH_REDIRECT_BASE",
  "SECRETS_BACKEND",
  "APP_CONFIG"
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
ENV_KEYS.forEach(key => {
  if (process.env[key] !== undefined) {
    originalEnv[key] = process.env[key];
  }
});

const tempDirs: string[] = [];

function createTempConfigFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-config-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "app.yaml");
  fs.writeFileSync(filePath, contents, "utf-8");
  return filePath;
}

function restoreEnv(): void {
  ENV_KEYS.forEach(key => {
    const original = originalEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  });
}

describe("loadConfig", () => {
  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    tempDirs.splice(0).forEach(dir => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
    restoreEnv();
  });

  it("loads configuration values from a YAML file", () => {
    const configPath = createTempConfigFile(`
runMode: enterprise
messaging:
  type: kafka
providers:
  defaultRoute: high_quality
  enabled:
    - anthropic
    - openai
auth:
  oauth:
    redirectBaseUrl: "https://example.com/callback"
secrets:
  backend: vault
`);
    process.env.APP_CONFIG = configPath;

    const config = loadConfig();

    expect(config.runMode).toBe("enterprise");
    expect(config.messaging.type).toBe("kafka");
    expect(config.providers.defaultRoute).toBe("high_quality");
    expect(config.providers.enabled).toEqual(["anthropic", "openai"]);
    expect(config.auth.oauth.redirectBaseUrl).toBe("https://example.com/callback");
    expect(config.secrets.backend).toBe("vault");
  });

  it("derives configuration from environment variables when file values are absent", () => {
    delete process.env.APP_CONFIG;
    process.env.RUN_MODE = "enterprise";
    process.env.MESSAGE_BUS = "kafka";
    process.env.PROVIDERS = "anthropic, openai";
    process.env.OAUTH_REDIRECT_BASE = "https://env.example.com/callback";
    process.env.SECRETS_BACKEND = "vault";

    const config = loadConfig();

    expect(config.runMode).toBe("enterprise");
    expect(config.messaging.type).toBe("kafka");
    expect(config.providers.defaultRoute).toBe("balanced");
    expect(config.providers.enabled).toEqual(["anthropic", "openai"]);
    expect(config.auth.oauth.redirectBaseUrl).toBe("https://env.example.com/callback");
    expect(config.secrets.backend).toBe("vault");
  });

  it("prefers MESSAGING_TYPE over MESSAGE_BUS when both are provided", () => {
    delete process.env.APP_CONFIG;
    process.env.MESSAGE_BUS = "rabbitmq";
    process.env.MESSAGING_TYPE = "kafka";

    const config = loadConfig();

    expect(config.messaging.type).toBe("kafka");
  });

  it("falls back to MESSAGE_BUS when MESSAGING_TYPE is unset", () => {
    delete process.env.APP_CONFIG;
    delete process.env.MESSAGING_TYPE;
    process.env.MESSAGE_BUS = "kafka";

    const config = loadConfig();

    expect(config.messaging.type).toBe("kafka");
  });

  it("merges file configuration with environment overrides using existing precedence", () => {
    const configPath = createTempConfigFile(`
runMode: enterprise
messaging:
  type: kafka
providers:
  defaultRoute: high_quality
  enabled:
    - anthropic
    - google
auth:
  oauth:
    redirectBaseUrl: "https://file.example.com/callback"
secrets:
  backend: vault
`);
    process.env.APP_CONFIG = configPath;
    process.env.RUN_MODE = "consumer";
    process.env.MESSAGE_BUS = "rabbitmq";
    process.env.PROVIDERS = "openai, mistral";
    process.env.OAUTH_REDIRECT_BASE = "https://env.example.com/callback";
    process.env.SECRETS_BACKEND = "localfile";

    const config = loadConfig();

    expect(config.runMode).toBe("enterprise");
    expect(config.messaging.type).toBe("kafka");
    expect(config.providers.defaultRoute).toBe("high_quality");
    expect(config.providers.enabled).toEqual(["openai", "mistral"]);
    expect(config.auth.oauth.redirectBaseUrl).toBe("https://env.example.com/callback");
    expect(config.secrets.backend).toBe("localfile");
  });
});
