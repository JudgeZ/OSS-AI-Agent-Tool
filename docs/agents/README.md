# Agent Profiles

Each agent has a dedicated profile under `agents/<name>/agent.md` with YAML front‑matter and guidance.

- Different agents can use different models, capabilities, and approval policies.
- The **AgentLoader** reads these files and configures the agent runtime.

See [`docs/agents.md`](../agents.md) for authoring guidance and `agents/templates/agent.md` for the scaffold used by the CLI (`aidt new-agent <name>`).
