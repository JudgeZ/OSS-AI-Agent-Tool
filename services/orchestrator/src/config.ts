import fs from "fs";
import path from "path";
import YAML from "yaml";

export type AppConfig = {
  runMode: "consumer" | "enterprise";
  messaging: { type: "rabbitmq" | "kafka" };
  providers: {
    defaultRoute: "balanced" | "high_quality" | "low_cost";
    enabled: string[];
  };
  auth: { oauth: { redirectBaseUrl: string } };
  secrets: { backend: "localfile" | "vault" };
  tooling: {
    agentEndpoint: string;
    retryAttempts: number;
    defaultTimeoutMs: number;
  };
};

type PartialAppConfig = {
  runMode?: AppConfig["runMode"];
  messaging?: Partial<AppConfig["messaging"]>;
  providers?: Partial<AppConfig["providers"]>;
  auth?: { oauth?: Partial<AppConfig["auth"]["oauth"]> };
  secrets?: Partial<AppConfig["secrets"]>;
  tooling?: Partial<AppConfig["tooling"]>;
};

const DEFAULT_CONFIG: AppConfig = {
  runMode: "consumer",
  messaging: { type: "rabbitmq" },
  providers: {
    defaultRoute: "balanced",
    enabled: ["openai", "local_ollama"]
  },
  auth: { oauth: { redirectBaseUrl: "http://127.0.0.1:8080" } },
  secrets: { backend: "localfile" },
  tooling: {
    agentEndpoint: "127.0.0.1:50051",
    retryAttempts: 3,
    defaultTimeoutMs: 15000
  }
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asRunMode(value: unknown): AppConfig["runMode"] | undefined {
  return value === "consumer" || value === "enterprise" ? value : undefined;
}

function asMessagingType(value: unknown): AppConfig["messaging"]["type"] | undefined {
  return value === "rabbitmq" || value === "kafka" ? value : undefined;
}

function asDefaultRoute(value: unknown): AppConfig["providers"]["defaultRoute"] | undefined {
  return value === "balanced" || value === "high_quality" || value === "low_cost" ? value : undefined;
}

function asSecretsBackend(value: unknown): AppConfig["secrets"]["backend"] | undefined {
  return value === "localfile" || value === "vault" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value
    .filter(item => typeof item === "string")
    .map(item => item.trim())
    .filter(item => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

export function loadConfig(): AppConfig {
  const cfgPath = process.env.APP_CONFIG || path.join(process.cwd(), "config", "app.yaml");
  let fileCfg: PartialAppConfig = {};
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = YAML.parse(fs.readFileSync(cfgPath, "utf-8"));
      const doc = asRecord(raw);
      if (doc) {
        const messaging = asRecord(doc.messaging);
        const providers = asRecord(doc.providers);
        const auth = asRecord(doc.auth);
        const oauth = asRecord(auth?.oauth);
        const secrets = asRecord(doc.secrets);
        const tooling = asRecord(doc.tooling);

        fileCfg = {
          runMode: asRunMode(doc.runMode),
          messaging: messaging ? { type: asMessagingType(messaging.type) } : undefined,
          providers: {
            defaultRoute: asDefaultRoute(providers?.defaultRoute),
            enabled: asStringArray(providers?.enabled)
          },
          auth: oauth
            ? {
                oauth: {
                  redirectBaseUrl: typeof oauth.redirectBaseUrl === "string" ? oauth.redirectBaseUrl : undefined
                }
              }
            : undefined,
          secrets: { backend: asSecretsBackend(secrets?.backend) },
          tooling: tooling
            ? {
                agentEndpoint: typeof tooling.agentEndpoint === "string" ? tooling.agentEndpoint : undefined,
                retryAttempts: asNumber(tooling.retryAttempts),
                defaultTimeoutMs: asNumber(tooling.defaultTimeoutMs)
              }
            : undefined
        };
      }
    }
  } catch {}

  const envRunMode = asRunMode(process.env.RUN_MODE);
  const envMessageType =
    asMessagingType(process.env.MESSAGING_TYPE) ?? asMessagingType(process.env.MESSAGE_BUS);
  const envProviders = process.env.PROVIDERS;
  const envRedirectBaseUrl = process.env.OAUTH_REDIRECT_BASE;
  const envSecretsBackend = asSecretsBackend(process.env.SECRETS_BACKEND);
  const envAgentEndpoint = process.env.TOOL_AGENT_ENDPOINT;
  const envAgentRetries = asNumber(process.env.TOOL_AGENT_RETRIES);
  const envAgentTimeout = asNumber(process.env.TOOL_AGENT_TIMEOUT_MS);

  const providersEnabledFromEnv = envProviders
    ? envProviders
        .split(",")
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
    : undefined;

  const providersEnabledFromFile = fileCfg.providers?.enabled;

  return {
    runMode: fileCfg.runMode ?? envRunMode ?? DEFAULT_CONFIG.runMode,
    messaging: {
      type: fileCfg.messaging?.type ?? envMessageType ?? DEFAULT_CONFIG.messaging.type
    },
    providers: {
      defaultRoute: fileCfg.providers?.defaultRoute ?? DEFAULT_CONFIG.providers.defaultRoute,
      enabled: providersEnabledFromEnv ?? providersEnabledFromFile ?? DEFAULT_CONFIG.providers.enabled
    },
    auth: {
      oauth: {
        redirectBaseUrl:
          envRedirectBaseUrl ??
          fileCfg.auth?.oauth?.redirectBaseUrl ??
          DEFAULT_CONFIG.auth.oauth.redirectBaseUrl
      }
    },
    secrets: {
      backend: envSecretsBackend ?? fileCfg.secrets?.backend ?? DEFAULT_CONFIG.secrets.backend
    },
    tooling: {
      agentEndpoint: envAgentEndpoint ?? fileCfg.tooling?.agentEndpoint ?? DEFAULT_CONFIG.tooling.agentEndpoint,
      retryAttempts: envAgentRetries ?? fileCfg.tooling?.retryAttempts ?? DEFAULT_CONFIG.tooling.retryAttempts,
      defaultTimeoutMs: envAgentTimeout ?? fileCfg.tooling?.defaultTimeoutMs ?? DEFAULT_CONFIG.tooling.defaultTimeoutMs
    }
  };
}
