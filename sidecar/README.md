# NARV Phoenix Sidecar v1.2

Local HTTP scoring service for the Chrome extension.

## Quick start

```bash
python3 sidecar/server.py
# http://127.0.0.1:8787  mode=hash
```

## Modes (`NARV_PHOENIX_MODE`)

| Mode | Description |
|------|-------------|
| `hash` | **Default.** Deterministic multi-action heads from content/id hashes, blended with proxy prior. No GPU, no 3GB download. |
| `proxy` | Pure heuristic heads (same family as in-extension proxy). |
| `jax` | Attempts to load xai-org/x-algorithm Phoenix ranker artifacts + JAX/Haiku. Falls back to hash if missing. |

```bash
NARV_PHOENIX_MODE=jax \
NARV_ARTIFACTS_DIR=/path/to/phoenix/artifacts \
NARV_PHOENIX_PATH=/path/to/x-algorithm/phoenix \
python3 sidecar/server.py
```

### Artifact layout (from x-algorithm LFS)

```
artifacts/ranker/config.json
artifacts/ranker/model_params.npz
artifacts/ranker/embedding_tables.npz
```

## API

| Method | Path | Body |
|--------|------|------|
| GET | `/health` | — |
| GET | `/v1/capabilities` | — |
| GET | `/v1/profiles` | — |
| POST | `/v1/score` | `{ tweet, context?, mode?, history? }` |
| POST | `/v1/score_batch` | `{ tweets, options? }` |
| POST | `/v1/validate` | `{ tweet, profileId?, weights?, context? }` |
| POST | `/v1/compare_profiles` | `{ tweet, profiles? }` |
| POST | `/v1/calibrate` | `{ history }` |

## Modules

| File | Role |
|------|------|
| `server.py` | HTTP API |
| `proxy_engine.py` | Heuristic multi-action |
| `jax_engine.py` | hash + jax loaders |
| `weighted_engine.py` | WeightedScorer / grade (Rust port) |

## Security

Bind to `127.0.0.1` only. Do not expose publicly.
