# Architecture Overview — OSS AI Agent Tool

The system combines a low-latency **inner loop** (gRPC/HTTP + SSE) with a durable **outer loop** (RabbitMQ or Kafka) to orchestrate multi-agent workflows for both **consumer** and **enterprise** deployments.

```mermaid
flowchart LR
  GUI((Desktop GUI / VS Code)) -->|SSE| GW[Gateway API]
  GW -->|gRPC/HTTP| ORCH[Orchestrator]
  ORCH --> IDX[Indexing Svc]
  ORCH --> MEM[Memory Svc (Redis+Postgres)]
  ORCH --> QUEUE>RabbitMQ/Kafka]
  ORCH --> PRV[Model Provider Registry]

  subgraph Agents & Tools
    A1[Code Writer]:::agent
    A2[Security Auditor]:::agent
    A3[Planner]:::agent
  end

  QUEUE <---> A1
  QUEUE <---> A2
  QUEUE <---> A3

  classDef agent fill:#eef,stroke:#66f;
```

**Key properties**
- **SSE** for efficient UI streaming.
- **Hybrid context engine** (symbolic + semantic + temporal).
- **Multi‑bus**: RabbitMQ (tasks) or Kafka (events/scale).
- **Multi‑provider** model routing (OpenAI, Anthropic, Gemini, Azure OpenAI, Bedrock, Mistral, OpenRouter, Local/Ollama).
- **Observability**: OpenTelemetry traces, Jaeger; structured logs; metrics dashboards.
- **Security**: least privilege, approvals, sandboxing, egress allow-lists, signed images and SBOMs.
