import fs from "fs";
import path from "path";

export type AppConfig = {
  runMode: "consumer" | "enterprise";
  messaging: { type: "rabbitmq" | "kafka" };
  providers: {
    defaultRoute: "balanced" | "high_quality" | "low_cost";
    enabled: string[];
  };
  auth: { oauth: { redirectBaseUrl: string } };
  secrets: { backend: "localfile" | "vault" };
};

export function loadConfig(): AppConfig {
  const envMode = (process.env.RUN_MODE as "consumer" | "enterprise") || "consumer";
  const cfgPath = process.env.APP_CONFIG || path.join(process.cwd(), "config", "app.yaml");
  let fileCfg: Partial<AppConfig> = {};
  try {
    const y = fs.readFileSync(cfgPath, "utf-8");
    // naive YAML parse to avoid external deps in bootstrap
    const mm = /runMode:\s*(\w+)/.exec(y);
    if (mm) fileCfg.runMode = mm[1] as any;
    const mq = /messaging:\s*[\s\S]*?type:\s*(\w+)/.exec(y);
    if (mq) fileCfg.messaging = { type: mq[1] as any };
  } catch {}
  return {
    runMode: fileCfg.runMode || envMode,
    messaging: fileCfg.messaging || { type: (process.env.MESSAGE_BUS as any) || "rabbitmq" },
    providers: {
      defaultRoute: "balanced",
      enabled: (process.env.PROVIDERS || "openai,local_ollama").split(",").map(s => s.trim())
    },
    auth: { oauth: { redirectBaseUrl: process.env.OAUTH_REDIRECT_BASE || "http://127.0.0.1:8080" } },
    secrets: { backend: (process.env.SECRETS_BACKEND as any) || "localfile" }
  };
}
