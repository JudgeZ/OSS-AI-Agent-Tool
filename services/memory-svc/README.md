# Memory Service

The memory service is a placeholder TypeScript/Express application that will eventually coordinate cache and state updates for the orchestrator. The current implementation exposes stub endpoints, schema validation, and a test harness so the repository CI can lint, build, and execute automated checks.

## Available endpoints

- `GET /healthz` – health probe used by orchestrators and tests.
- `POST /state/cache` – validates cache write requests and responds with an acceptance stub.
- `GET /state/cache/:key` – returns a placeholder payload to indicate lookup handling is not yet implemented.

## Development

```bash
npm install
npm run dev
```

## Testing

```bash
npm test
```
