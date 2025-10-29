# ADR 0002: SSE for Streaming

- Status: Accepted
- Context: UI requires token streaming with low overhead.
- Decision: Use **Server-Sent Events (SSE)** for GUI updates; reserve WebSockets for true bi-directional use.
- Consequences: Simpler infra and backpressure; limited client->server messaging.
- Alternatives: WebSockets everywhere; HTTP long-polling.
