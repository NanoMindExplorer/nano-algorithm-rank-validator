# NARV Integrations Guide (v1.2)

Complete map of every integration layer in **Nano Algorithm Rank Validator**.

## Architecture

```
┌──────────────────────────── Chrome Extension (MV3) ────────────────────────────┐
│  content script (x.com)                                                         │
│    ├─ tweet-parser → features → filters                                         │
│    ├─ phoenix-proxy (in-page)  ──┬── WeightedScorer → diversity → OON → grade  │
│    ├─ sidecar client ────────────┘                                              │
│    ├─ profiles / compare (A/B)                                                  │
│    ├─ sampler (engagement history) → affinity                                   │
│    └─ export CSV/JSON                                                           │
│  options · popup · background storage                                           │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                    │ optional HTTP
                                    ▼
┌──────────────────── Local Phoenix Sidecar (Python) ────────────────────────────┐
│  modes: proxy | hash | jax                                                      │
│  /v1/score  /v1/validate  /v1/compare_profiles  /v1/calibrate  /v1/capabilities │
│  weighted_engine.py mirrors home-mixer RankingScorer structure                  │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 1. Weight profiles

| ID | Goal |
|----|------|
| `balanced` | Research-calibrated defaults |
| `conversation` | Reply / quote / follow |
| `media` | VQV / photo / dwell |
| `news` | Click / share link |
| `viral` | Repost / share cascade |
| `demo_pipeline` | OSS `run_pipeline.py` toy weights |

**Code:** `src/lib/profiles.js` · Options UI · sidecar `PROFILES`

## 2. Affinity calibration

Import engagement history → `historyAffinity` + suggested profile.

Formats:

```json
{ "engagements": [{ "liked": true, "replied": true, "text": "..." }] }
```

```json
{ "history": [{ "actions": { "1": 1, "4": 1 }, "text": "..." }] }
```

**Code:** `src/lib/affinity.js` · Options · `POST /v1/calibrate` · sample `test/sample-history.json`

## 3. Engagement auto-sampler

| Action | How |
|--------|-----|
| Bulk import likes | Open `/likes` → panel **Sample hist** → Import |
| Manual | Hover tweet → **+HIST** |
| Auto on likes load | Options → Auto-sample on /likes |
| Calibrate | Sample hist → Calibrate affinity |
| Export | Export history JSON |

**Code:** `src/lib/sampler.js` · storage key `engagementSamples` (local)

## 4. Export

| Format | Trigger |
|--------|---------|
| CSV timeline | Scan → Export CSV |
| JSON timeline | Scan → Export JSON |
| Single report | Report → Download JSON / copy |
| A/B compare | A/B profiles → Export |

**Code:** `src/lib/export.js`

## 5. A/B profile compare

Scores the **same** tweet under multiple weight profiles (same Phoenix heads).

- Panel → **A/B profiles** · shortcut `Alt+Shift+C`
- Sidecar: `POST /v1/compare_profiles`

**Code:** `src/lib/compare.js`

## 6. Phoenix sidecar

```bash
# hash mode (default) — deterministic multi-action, no GPU
python3 sidecar/server.py

# proxy-only heuristics
NARV_PHOENIX_MODE=proxy python3 sidecar/server.py

# jax path (needs unpacked Phoenix artifacts + jax/haiku)
NARV_PHOENIX_MODE=jax \
NARV_ARTIFACTS_DIR=/path/to/phoenix/artifacts \
NARV_PHOENIX_PATH=/path/to/x-algorithm/phoenix \
python3 sidecar/server.py
```

### API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + artifact probe |
| GET | `/v1/capabilities` | JAX/artifact status |
| GET | `/v1/profiles` | Server profiles |
| POST | `/v1/score` | Phoenix heads only |
| POST | `/v1/score_batch` | Batch heads |
| POST | `/v1/validate` | Heads + WeightedScorer |
| POST | `/v1/compare_profiles` | A/B profiles |
| POST | `/v1/calibrate` | Affinity from history |

### JAX artifacts (xai-org/x-algorithm)

Expected layout after extracting LFS archive:

```
artifacts/
  ranker/config.json
  ranker/model_params.npz
  ranker/embedding_tables.npz
  retrieval/...
  example_sequence.json
```

If ranker files are missing, jax mode falls back to **hash** blend automatically.

## 7. Packaging & CI

```bash
npm test                 # node smoke
npm run sidecar          # start server
npm run build            # dist/*.zip full package
npm run build:store      # zip without sidecar (CWS-oriented)
```

GitHub Actions: `.github/workflows/ci.yml` runs smoke + sidecar API + zip.

## 8. Keyboard shortcuts (on x.com)

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+N` | Validate active tweet |
| `Alt+Shift+C` | A/B profile compare |
| `Alt+Shift+S` | Engagement sampler panel |

## 9. Honesty bounds

- Production Phoenix uses private weights + live user sequences + multi-GB models.
- NARV implements **public structure** faithfully; numeric weights are research-calibrated and user-editable.
- Hash/jax sidecar improves consistency and offline batch tooling; it is **not** identical to production inference.

## 10. File index

| Path | Role |
|------|------|
| `src/lib/pipeline.js` | Orchestrator |
| `src/lib/weighted-scorer.js` | Σ w·P |
| `src/lib/phoenix-proxy.js` | In-page heads |
| `src/lib/profiles.js` | Weight profiles |
| `src/lib/affinity.js` | History → affinity |
| `src/lib/sampler.js` | Opt-in history collector |
| `src/lib/compare.js` | A/B profiles |
| `src/lib/export.js` | CSV/JSON |
| `src/lib/sidecar.js` | HTTP client |
| `sidecar/*.py` | Local scoring service |
| `scripts/build-extension.sh` | Zip builder |
