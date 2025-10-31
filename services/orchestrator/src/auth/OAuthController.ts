import type { Request, Response } from "express";
import { loadConfig } from "../config.js";
import { getSecretsStore } from "../providers/ProviderRegistry.js";
import { type SecretsStore } from "./SecretsStore.js";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  [key: string]: unknown;
};

type ProviderConfig = {
  name: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  extraParams?: Record<string, string>;
};

function secrets(): SecretsStore {
  return getSecretsStore();
}

function getProviderConfig(provider: string): ProviderConfig | undefined {
  const cfg = loadConfig();
  const redirectBase = cfg.auth.oauth.redirectBaseUrl.replace(/\/$/, "");
  const definitions: Record<string, ProviderConfig> = {
    openrouter: {
      name: "openrouter",
      tokenUrl: "https://openrouter.ai/api/v1/oauth/token",
      clientId: process.env.OPENROUTER_CLIENT_ID ?? "",
      clientSecret: process.env.OPENROUTER_CLIENT_SECRET,
      redirectUri: `${redirectBase}/auth/openrouter/callback`,
      extraParams: { grant_type: "authorization_code" }
    },
    google: {
      name: "google",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: `${redirectBase}/auth/google/callback`,
      extraParams: { grant_type: "authorization_code" }
    }
  };

  const def = definitions[provider];
  if (!def || !def.clientId) {
    return undefined;
  }
  return def;
}

export async function authorize(req: Request, res: Response) {
  const provider = req.params.provider;
  const cfg = getProviderConfig(provider);
  if (!cfg) {
    res.status(404).json({ error: "unknown provider" });
    return;
  }
  res.json({ provider: cfg.name, redirectUri: cfg.redirectUri });
}

export async function callback(req: Request, res: Response) {
  const provider = req.params.provider;
  const cfg = getProviderConfig(provider);
  if (!cfg) {
    res.status(404).json({ error: "unknown provider" });
    return;
  }

  const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = req.body ?? {};
  if (typeof code !== "string" || code.length === 0) {
    res.status(400).json({ error: "code is required" });
    return;
  }
  if (typeof codeVerifier !== "string" || codeVerifier.length < 43) {
    res.status(400).json({ error: "code_verifier is required" });
    return;
  }
  if (typeof redirectUri !== "string" || redirectUri !== cfg.redirectUri) {
    res.status(400).json({ error: "redirect_uri mismatch" });
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(cfg, code, codeVerifier);
    const store = secrets();
    const normalizedTokens: TokenResponse & { expires_at?: number } = { ...tokens };
    if (typeof tokens.expires_in === "number") {
      normalizedTokens.expires_at = Date.now() + tokens.expires_in * 1000;
    }
    await Promise.all([
      store.set(`oauth:${provider}:access_token`, tokens.access_token),
      store.set(`oauth:${provider}:tokens`, JSON.stringify(normalizedTokens)),
      tokens.refresh_token
        ? store.set(`oauth:${provider}:refresh_token`, tokens.refresh_token)
        : store.delete(`oauth:${provider}:refresh_token`)
    ]);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to exchange code";
    res.status(502).json({ error: message });
  }
}

async function exchangeCodeForTokens(cfg: ProviderConfig, code: string, codeVerifier: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    grant_type: "authorization_code"
  });
  if (cfg.clientSecret) {
    params.set("client_secret", cfg.clientSecret);
  }
  if (cfg.extraParams) {
    for (const [key, value] of Object.entries(cfg.extraParams)) {
      params.set(key, value);
    }
  }

  const response = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `token endpoint returned ${response.status}`);
  }
  const payload = (await response.json()) as TokenResponse;
  if (typeof payload.access_token !== "string") {
    throw new Error("access_token missing in response");
  }
  return payload;
}
