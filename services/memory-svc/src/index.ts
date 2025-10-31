import express from "express";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const app = express();
app.use(express.json());

const memory: Record<string, unknown> = {};

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/state/:key", (req, res) => {
  const { key } = req.params;
  memory[key] = req.body;
  logger.debug({ key }, "state upserted");
  res.status(202).json({ status: "accepted" });
});

app.get("/state/:key", (req, res) => {
  const { key } = req.params;
  if (!(key in memory)) {
    res.status(404).json({ error: "not found" });
    return;
  }

  res.json({ key, value: memory[key] });
});

const port = Number.parseInt(process.env.PORT ?? "8081", 10);
const server = app.listen(port, () => {
  logger.info({ port }, "memory-svc listening");
});

const shutdown = (signal: NodeJS.Signals) => {
  logger.info({ signal }, "shutting down memory-svc");
  server.close(() => {
    logger.info("memory-svc exited cleanly");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
