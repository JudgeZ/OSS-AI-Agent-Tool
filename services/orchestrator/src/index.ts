import express, { type NextFunction, type Request, type Response } from "express";
import { authorize, callback } from "./auth/OAuthController.js";
import { loadConfig } from "./config.js";
import type { ChatRequest } from "./providers/interfaces.js";
import { routeChat } from "./providers/ProviderRegistry.js";
import { createPlan } from "./plan/planner.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    const cfg = loadConfig();
    res.json({ status: "ok", runMode: cfg.runMode, messaging: cfg.messaging.type });
  });

  app.post("/chat", async (req, res, next) => {
    try {
      const body = req.body as Partial<ChatRequest>;
      if (!isValidMessages(body?.messages)) {
        res.status(400).json({ error: "invalid_messages" });
        return;
      }
      const chatRequest: ChatRequest = {
        messages: body.messages,
        model: typeof body?.model === "string" ? body.model : undefined
      };
      const response = await routeChat(chatRequest);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/plans", (req, res) => {
    const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
    if (!goal) {
      res.status(400).json({ error: "goal_required" });
      return;
    }
    const plan = createPlan(goal);
    res.status(201).json(plan);
  });

  app.get("/auth/:provider/authorize", authorize);
  app.get("/auth/:provider/callback", callback);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("Unhandled orchestrator error", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

export function startServer() {
  const port = Number.parseInt(process.env.PORT ?? "", 10) || 4000;
  const app = createApp();
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Orchestrator listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

function isValidMessages(
  messages: ChatRequest["messages"] | undefined
): messages is ChatRequest["messages"] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  return messages.every(message =>
    message &&
    typeof message === "object" &&
    (message.role === "system" || message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

if (require.main === module) {
  startServer();
}
