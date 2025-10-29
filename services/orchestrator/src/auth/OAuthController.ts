import type { Request, Response } from "express";
import { loadConfig } from "../config.js";
import { LocalFileStore, VaultStore, SecretsStore } from "./SecretsStore.js";

function secrets(): SecretsStore {
  const cfg = loadConfig();
  return cfg.secrets.backend === "vault" ? new VaultStore() : new LocalFileStore();
}

export async function authorize(req: Request, res: Response) {
  const provider = req.params.provider;
  // In a real impl: generate state, PKCE, and redirect to provider auth URL.
  res.json({ ok: true, provider, redirect: `/auth/${provider}/callback?code=demo` });
}

export async function callback(req: Request, res: Response) {
  const provider = req.params.provider;
  const code = req.query.code as string;
  // Exchange code for token(s). Store securely.
  const s = secrets();
  await s.set(`oauth:${provider}:access_token`, `token_for_${provider}_${code}`);
  res.json({ ok: true, provider });
}
