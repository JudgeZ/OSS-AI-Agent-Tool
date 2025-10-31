import { Server, ServerCredentials, status } from "@grpc/grpc-js";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";

import { ToolAgentClient, ToolClientError, resetToolAgentClient } from "./AgentClient.js";
import { AgentServiceService, type ExecuteToolRequest, type ExecuteToolResponse } from "./generated/agent.js";

let server: Server;
let port: number;
let handler: (request: ExecuteToolRequest) => Promise<ExecuteToolResponse>;

beforeAll(async () => {
  handler = async () => ({ events: [] });
  server = new Server();
  server.addService(AgentServiceService, {
    executeTool: (call, callback) => {
      handler(call.request)
        .then(response => callback(null, response))
        .catch(error => {
          if (error && typeof error === "object" && "code" in error) {
            callback(error as any, null);
          } else {
            callback({ code: status.UNKNOWN, message: (error as Error)?.message ?? "unknown" } as any, null);
          }
        });
    }
  });
  port = await new Promise<number>((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (error, actualPort) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(actualPort);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.start();
    resolve();
  });
});

afterEach(() => {
  resetToolAgentClient();
});

afterAll(async () => {
  await new Promise<void>(resolve => {
    server.tryShutdown(() => resolve());
  });
});

describe("ToolAgentClient", () => {
  it("returns tool events from the agent server", async () => {
    handler = async request => {
      expect(request.invocation?.tool).toBe("code_writer");
      return {
        events: [
          {
            invocationId: request.invocation?.invocationId ?? "inv", 
            planId: request.invocation?.planId ?? "plan-1",
            stepId: request.invocation?.stepId ?? "s1",
            state: "completed",
            summary: "done",
            outputJson: "{}",
            occurredAt: new Date().toISOString()
          }
        ]
      };
    };

    const client = new ToolAgentClient({
      endpoint: `127.0.0.1:${port}`,
      retryAttempts: 2,
      defaultTimeoutMs: 2000
    });

    const events = await client.executeTool({
      invocationId: "inv-1",
      planId: "plan-1",
      stepId: "s1",
      tool: "code_writer",
      capability: "repo.write",
      capabilityLabel: "Apply repository changes",
      labels: ["repo"],
      input: { goal: "test" },
      metadata: { actor: "tester" }
    });

    expect(events).toHaveLength(1);
    expect(events[0].state).toBe("completed");
    expect(events[0].summary).toBe("done");
  });

  it("retries transient errors before succeeding", async () => {
    let attempt = 0;
    handler = async request => {
      attempt += 1;
      if (attempt === 1) {
        const error: Partial<ToolClientError> & { code: number; message: string } = {
          code: status.UNAVAILABLE,
          message: "temporarily unavailable"
        };
        throw error;
      }
      return {
        events: [
          {
            invocationId: request.invocation?.invocationId ?? "inv",
            planId: request.invocation?.planId ?? "plan",
            stepId: request.invocation?.stepId ?? "step",
            state: "completed",
            summary: "ok",
            outputJson: "{}",
            occurredAt: new Date().toISOString()
          }
        ]
      };
    };

    const client = new ToolAgentClient({
      endpoint: `127.0.0.1:${port}`,
      retryAttempts: 3,
      defaultTimeoutMs: 2000,
      baseDelayMs: 5
    });

    const events = await client.executeTool({
      planId: "plan-retry",
      stepId: "step-1",
      tool: "test_runner",
      capability: "test.run",
      capabilityLabel: "Execute tests",
      labels: [],
      input: {},
      metadata: {}
    });

    expect(attempt).toBe(2);
    expect(events[0].state).toBe("completed");
  });

  it("surfaces non-retryable errors", async () => {
    handler = async () => {
      const error: Partial<ToolClientError> & { code: number; message: string } = {
        code: status.INVALID_ARGUMENT,
        message: "bad input"
      };
      throw error;
    };

    const client = new ToolAgentClient({
      endpoint: `127.0.0.1:${port}`,
      retryAttempts: 1,
      defaultTimeoutMs: 1000
    });

    try {
      await client.executeTool({
        planId: "plan-fail",
        stepId: "s42",
        tool: "code_writer",
        capability: "repo.write",
        capabilityLabel: "Apply repository changes",
        labels: [],
        input: {},
        metadata: {}
      });
      throw new Error("expected client to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolClientError);
      const toolError = error as ToolClientError;
      expect(toolError.retryable).toBe(false);
      expect(toolError.message).toContain("bad input");
    }
  });
});
