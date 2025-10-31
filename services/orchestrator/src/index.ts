import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import morgan from "morgan";

import { createPlan } from "./plan/planner.js";
import {
  getLatestPlanStepEvent,
  getPlanHistory,
  publishPlanStepEvent,
  subscribeToPlanSteps,
  type PlanStepEvent
} from "./plan/events.js";
import { routeChat } from "./providers/ProviderRegistry.js";
import { withSpan } from "./observability/tracing.js";
import {
  initializePlanQueueRuntime,
  persistPlanStepState,
  submitPlanSteps
} from "./queue/PlanQueueRuntime.js";
import { authorize as oauthAuthorize, callback as oauthCallback } from "./auth/OAuthController.js";

initializePlanQueueRuntime().catch(error => {
  // eslint-disable-next-line no-console
  console.error("Failed to initialize queue runtime", error);
});

function formatSse(event: PlanStepEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createServer(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/auth/:provider/authorize", oauthAuthorize);
  app.post("/auth/:provider/callback", oauthCallback);

  app.post("/plan", async (req: Request, res: Response, next: NextFunction) => {
    const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
    if (!goal) {
      res.status(400).json({ error: "goal is required" });
      return;
    }

    try {
      const result = await withSpan(
        "http.post.plan",
        async span => {
          const plan = createPlan(goal);
          span.setAttribute("plan.id", plan.id);
          span.setAttribute("plan.steps", plan.steps.length);
          await submitPlanSteps(plan, span.context.traceId);
          return { plan, traceId: span.context.traceId };
        },
        { route: "/plan" }
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/plan/:id/events", (req: Request, res: Response) => {
    const { id } = req.params;
    if (req.headers.accept?.includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      let replayingHistory = true;
      const buffered: PlanStepEvent[] = [];

      const writeEvent = (event: PlanStepEvent) => {
        res.write(formatSse(event));
      };

      const unsubscribe = subscribeToPlanSteps(id, event => {
        if (replayingHistory) {
          buffered.push(event);
          return;
        }
        writeEvent(event);
      });

      const history = getPlanHistory(id);
      history.forEach(writeEvent);

      replayingHistory = false;
      buffered.splice(0).forEach(writeEvent);

      const keepAlive = setInterval(() => {
        res.write(": keep-alive\n\n");
      }, 25000);

      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
        res.end();
      });
    } else {
      const events = getPlanHistory(id);
      res.json({ events });
    }
  });

  app.post("/plan/:planId/steps/:stepId/approve", async (req: Request, res: Response, next: NextFunction) => {
    const { planId, stepId } = req.params;
    const latest = getLatestPlanStepEvent(planId, stepId);
    if (!latest) {
      res.status(404).json({ error: "Step not found" });
      return;
    }

    if (latest.step.state !== "waiting_approval") {
      res.status(409).json({ error: "Step is not awaiting approval" });
      return;
    }

    const decision: "approved" | "rejected" = req.body?.decision === "reject" ? "rejected" : "approved";
    const rationale = typeof req.body?.rationale === "string" ? req.body.rationale.trim() : "";
    const summary = rationale ? `${latest.step.summary ?? ""}${latest.step.summary ? " " : ""}(${decision}: ${rationale})` : latest.step.summary;

    try {
      await persistPlanStepState(planId, stepId, decision, summary);
      publishPlanStepEvent({
        event: "plan.step",
        traceId: latest.traceId,
        planId,
        step: {
          ...latest.step,
          state: decision,
          summary
        }
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
    const { messages, model } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    try {
      const result = await withSpan(
        "http.post.chat",
        async span => {
          span.setAttribute("chat.message_count", messages.length);
          if (typeof model === "string") {
            span.setAttribute("chat.model", model);
          }
          const response = await routeChat({ messages, model });
          return { response, traceId: span.context.traceId };
        },
        { route: "/chat" }
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof Error && "status" in error ? Number((error as { status: number }).status) : 500;
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(Number.isFinite(status) ? status : 500).json({ error: message });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 4000;
  const server = createServer();
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.info(`orchestrator listening on http://localhost:${port}`);
  });
}
