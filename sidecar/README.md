# NARV Phoenix Sidecar

Optional local HTTP server so the Chrome extension can request multi-action scores
from a process you control (instead of only the in-page proxy).

## Quick start

```bash
python3 sidecar/server.py
# → http://127.0.0.1:8787
```

In the extension **Options**:

1. Enable **Phoenix sidecar**
2. URL: `http://127.0.0.1:8787`
3. Click **Test connection**
4. Save

If the sidecar is offline, NARV automatically falls back to the built-in proxy.

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ ok, version, mode }` |
| POST | `/v1/score` | `{ tweet, context? }` | `{ phoenixScores, meta }` |
| POST | `/v1/score_batch` | `{ tweets, options? }` | `{ results }` |

`phoenixScores` keys match `home-mixer` / NARV:

`favorite_score`, `reply_score`, `retweet_score`, … `report_score`, etc.

## Modes

| Env | Meaning |
|-----|---------|
| `NARV_PHOENIX_MODE=proxy` (default) | Fast multi-action estimator, no model files |
| `NARV_PHOENIX_MODE=jax` | Hook for real Phoenix artifacts (stub until you wire checkpoints) |

```bash
NARV_SIDECAR_PORT=8787 NARV_PHOENIX_MODE=proxy python3 sidecar/server.py
```

## CORS

The server sends `Access-Control-Allow-Origin: *` so the content script can call
localhost. Only bind to `127.0.0.1` unless you know you need otherwise.

## Security

- Do **not** expose this port to the public internet.
- Treat imported engagement history as private.
