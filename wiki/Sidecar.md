# Sidecar

Server HTTP lokal untuk multi-action scores & pipeline weighted scoring.

## Jalankan

```bash
python3 sidecar/server.py
# http://127.0.0.1:8787
```

atau `npm run sidecar`.

## Mode (`NARV_PHOENIX_MODE`)

| Mode | Keterangan |
|------|------------|
| `hash` | **Default.** Heads deterministik dari hash fitur + blend proxy. Tanpa GPU. |
| `proxy` | Heuristik murni (mirip in-page). |
| `jax` | Coba load artifact Phoenix (x-algorithm). Fallback ke hash jika gagal. |

```bash
NARV_PHOENIX_MODE=jax \
NARV_ARTIFACTS_DIR=/path/to/phoenix/artifacts \
NARV_PHOENIX_PATH=/path/to/x-algorithm/phoenix \
python3 sidecar/server.py
```

### Layout artifact (setelah extract LFS)

```
artifacts/ranker/config.json
artifacts/ranker/model_params.npz
artifacts/ranker/embedding_tables.npz
```

## Modul Python

| File | Peran |
|------|--------|
| `server.py` | HTTP API |
| `proxy_engine.py` | Heads heuristik |
| `jax_engine.py` | hash + loader jax |
| `weighted_engine.py` | WeightedScorer + grade |

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | version, mode, artifacts, endpoints |
| GET | `/v1/capabilities` | — | status JAX/artifact |
| GET | `/v1/profiles` | — | profil server + default weights |
| POST | `/v1/score` | `{ tweet, context?, mode?, history? }` | `phoenixScores` |
| POST | `/v1/score_batch` | `{ tweets, options? }` | `results[]` |
| POST | `/v1/validate` | `{ tweet, profileId?, weights?, context? }` | scores + weighted + grade |
| POST | `/v1/compare_profiles` | `{ tweet, profiles? }` | ranking profil |
| POST | `/v1/calibrate` | `{ history }` / engagements | affinity |

### Contoh

```bash
curl -s http://127.0.0.1:8787/health | jq

curl -s -X POST http://127.0.0.1:8787/v1/validate \
  -H 'Content-Type: application/json' \
  -d '{
    "tweet": {
      "text": "What is your take on open algorithms?\n\nReply below",
      "hasImage": true,
      "viewCount": 5000,
      "likeCount": 200,
      "replyCount": 80
    },
    "profileId": "conversation",
    "context": { "historyAffinity": 0.8, "inNetwork": true }
  }'
```

## Koneksi dari extension

1. Options → **Enable sidecar**  
2. URL: `http://127.0.0.1:8787`  
3. Mode engine: hash / proxy / jax  
4. **Test connection** → Save  

Jika offline, extension **otomatis fallback** ke proxy in-page.

## Keamanan

- Hanya bind `127.0.0.1`  
- Jangan expose port ke internet  
- CORS `*` untuk localhost content script  

Lihat: [[Development]] · [[Integrations]]
