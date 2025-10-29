import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { routeChat } from "./providers/ProviderRegistry.js";
import type { ChatRequest } from "./providers/interfaces.js";
import { authorize, callback } from "./auth/OAuthController.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const config = loadConfig();
const port = Number.parseInt(process.env.PORT ?? "", 10) || 3001;

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, mode: config.runMode, uptime: process.uptime() });
});

app.post("/v1/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as ChatRequest;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({ error: "messages array required" });
      return;
    }
    const response = await routeChat(body);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/:provider", authorize);
app.get("/auth/:provider/callback", callback);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("orchestrator request error", err);
  const status = typeof (err as any)?.status === "number" ? (err as any).status : 500;
  res.status(status).json({ error: "internal_error" });
};

app.use(errorHandler);

const server = app.listen(port, () => {
  console.log(`[orchestrator] listening on port ${port} (mode=${config.runMode})`);
});

const shutdown = () => {
  console.log("[orchestrator] shutting down");
  server.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
