# ADR 0003: Support RabbitMQ and Kafka

- Status: Accepted
- Context: Consumers prefer simple task queues; enterprises prefer event streams and ecosystem integrations.
- Decision: Offer **RabbitMQ** and **Kafka** with Helm toggles and runtime config.
- Consequences: Slightly larger maintenance surface; broader adoption.
- Alternatives: Pick one bus (risk vendor lock-in / limited fit).
