# UNS Record Indexer

Indexes one UNS record key on Base chain and stores the current value per token in PostgreSQL.

- Event: `Set(uint256 tokenId, string keyIndex, string valueIndex, string key, string value)`
- Event: `ResetRecords(uint256 tokenId)`
- Key in scope: `token.ANYONE.ANYONE.ANYONE.address` (configurable via `WATCHED_UNS_KEY`)
- Value rule: must end with `.anyone` (configurable via `REQUIRED_VALUE_SUFFIX`)

`Set` upserts the indexed value for a token when the key and suffix match.  
`ResetRecords` sets the value to `NULL` for that token (if a record exists).

## Operational Overview

### Startup sequence

1. NestJS bootstraps and connects to PostgreSQL. TypeORM schema-syncs all entities on first run.
2. `RpcEndpointManagerService` reads Infura (primary) and Alchemy (backup) URLs for both WebSocket and HTTP transports.
3. `RealtimeIndexerService` opens a WebSocket connection to the active provider and subscribes to `Set` and `ResetRecords` logs for the configured contract address.
4. `HealingService` immediately runs its first backfill cycle, then waits `HEALING_INTERVAL_MS` after each cycle completes before running again.

### Event flow

```
  WSS (Infura → Alchemy)              HTTP JSON-RPC (Infura → Alchemy)
          │                                     │
          ▼                                     ▼
 RealtimeIndexerService               HealingService (loop)
          │                                     │
          └────────── RpcEndpointManagerService ──────────┐
                         (sticky failover,                │
                          heal-back, logging)             │
                                    │                     │
                                    ▼                     ▼
                           EventProcessorService
          ┌─────────────────────────────────────────────┐
          │ 1. Check processed_logs (transactionHash +  │
          │    logIndex) — skip if already seen         │
          │ 2. Set:  if key matches && value ends in    │
          │          .anyone → upsert hidden_service_   │
          │          records for tokenId                │
          │    ResetRecords: set value = NULL for       │
          │          tokenId (if record exists)         │
          │ 3. Insert processed_log row                 │
          │ 4. Bump indexer_checkpoint                  │
          └─────────────────────────────────────────────┘
                   │
                   ▼
              PostgreSQL
```

### Data tables

| Table | Purpose |
|---|---|
| `hidden_service_records` | Current indexed `.anyone` address per token |
| `indexer_checkpoints` | Last processed block number |
| `processed_logs` | Deduplication — every `(transactionHash, logIndex)` seen |

### Reconnection and fault tolerance

- WebSocket disconnects trigger exponential backoff reconnect (1 s → 30 s cap). Any gaps created during a disconnect are filled by the next healing cycle.
- A WebSocket stall detector force-reconnects (and rotates providers) if no events arrive for `RPC_WS_STALL_MS` (default 120 s).
- The healing loop is idempotent: reprocessing already-seen logs is a no-op due to `processed_logs` dedup.
- `BLOCK_CONFIRMATIONS` (default 12) ensures healing only processes finalized blocks.
- On shutdown, NestJS waits for any in-flight healing cycle to complete before closing DB connections.

### RPC provider failover

The indexer uses Infura as the primary JSON-RPC/WebSocket provider and falls back to Alchemy on errors. Failover is managed independently per transport (ws vs http) by `RpcEndpointManagerService` and is **sticky with heal-back**:

- After rotating to Alchemy, the service stays on Alchemy until `RPC_FAILOVER_COOLDOWN_MS` elapses (default 10 min), then the next call returns to Infura. Set `RPC_FAILOVER_HEAL_BACK_ENABLED=false` to disable heal-back entirely — once rotated, the service sticks with the backup until it too fails a rotation trigger.
- Rotation is immediate on "hard" signals: HTTP 429 (rate limit), WebSocket `error` events, and WebSocket stalls.
- Rotation is triggered after `RPC_FAILOVER_ERROR_THRESHOLD` consecutive "soft" errors: HTTP 5xx, timeouts, and connection resets.
- If only Infura is configured (no Alchemy URL), the service runs in single-endpoint mode and logs a warning at startup.
- All rotation and heal-back events are logged via the NestJS logger (e.g. `RPC failover: ws infura → alchemy (reason=ws_stall)`, `RPC heal-back: http alchemy → infura (cooldown elapsed)`).

### Rate limiting and range splitting

The healing service queries `eth_getLogs` in chunks (`HEALING_BLOCK_CHUNK_SIZE` blocks per request) with a configurable delay between chunks (`HEALING_CHUNK_DELAY_MS`). If a request fails:

- **Rate limited (429)**: retries with exponential backoff (1 s → 2 s → 4 s → 8 s, max 4 retries).
- **Range too large**: the block range is recursively bisected until the provider accepts it.

## Configuration

All configuration is via environment variables. Copy `.env.example` and fill in the required values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `INFURA_WS_RPC_URL` | yes | — | Infura WebSocket endpoint for Base (primary) |
| `INFURA_HTTP_RPC_URL` | yes | — | Infura HTTP endpoint for Base (primary) |
| `ALCHEMY_WS_RPC_URL` | no | — | Alchemy WebSocket endpoint for Base (backup); failover disabled if empty |
| `ALCHEMY_HTTP_RPC_URL` | no | — | Alchemy HTTP endpoint for Base (backup); failover disabled if empty |
| `RPC_FAILOVER_COOLDOWN_MS` | no | `600000` | How long to stay on the backup provider before trying the primary again (ms); ignored when heal-back is disabled |
| `RPC_FAILOVER_HEAL_BACK_ENABLED` | no | `true` | When `false`, never automatically return to the primary provider after a failover |
| `RPC_FAILOVER_ERROR_THRESHOLD` | no | `3` | Consecutive soft errors (5xx/timeout) before rotating providers |
| `RPC_WS_STALL_MS` | no | `120000` | Reconnect and rotate if no WS events received within this window (ms) |
| `UNS_CONTRACT_ADDRESS` | yes | — | UNS registry contract address |
| `START_BLOCK` | yes | `0` | Block to start indexing from |
| `PORT` | no | `3000` | HTTP port |
| `BLOCK_CONFIRMATIONS` | no | `12` | Blocks behind tip considered final |
| `WATCHED_UNS_KEY` | no | `token.ANYONE.ANYONE.ANYONE.address` | Record key to index |
| `REQUIRED_VALUE_SUFFIX` | no | `.anyone` | Required suffix on indexed values |
| `DB_HOST` | no | `localhost` | PostgreSQL host |
| `DB_PORT` | no | `5432` | PostgreSQL port |
| `DB_USER` | no | `postgres` | PostgreSQL user |
| `DB_PASSWORD` | no | `postgres` | PostgreSQL password |
| `DB_NAME` | no | `uns_indexer` | PostgreSQL database |
| `HEALING_INTERVAL_MS` | no | `300000` | Delay between healing cycles (ms) |
| `HEALING_BLOCK_CHUNK_SIZE` | no | `2000` | Blocks per `eth_getLogs` request |
| `HEALING_CHUNK_DELAY_MS` | no | `250` | Delay between chunk requests (ms) |

## Run Locally (No Docker)

```bash
npm install
npm run start:dev
```

## Docker

Build and run the app container directly:

```bash
docker build -t uns-record-indexer .
docker run --rm --env-file .env -p 3000:3000 uns-record-indexer
```

## Docker Compose

Pass an env file and run PostgreSQL and indexer together:

```bash
docker compose --env-file /path/to/your.env up --build
```

Stop and remove containers:

```bash
docker compose down
```

Stop and remove containers plus Postgres volume:

```bash
docker compose down -v
```

## Health Endpoint

`GET /health` — returns service health with checkpoint and indexed-record counters.

```json
{
  "ok": true,
  "lastProcessedBlock": 12345678,
  "indexedRecords": 42,
  "updatedAt": "2026-04-21T12:00:00.000Z"
}
```

## Development Note

TypeORM is configured with `synchronize: true` for early development. Disable this and use migrations before production.
