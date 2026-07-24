# Nano Algorithm Rank Validator

**Chrome extension** that validates and ranks posts on [X](https://x.com) against the open-source **For You** recommendation pipeline from [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).

> **NARV** · Version **1.2.0** · [Integrations guide](docs/INTEGRATIONS.md) · [Research notes](docs/RESEARCH.md)

![Manifest V3](https://img.shields.io/badge/MV3-ready-1d9bf0)
![CI](https://img.shields.io/badge/CI-smoke%20%2B%20sidecar-00ba7c)

---

## Features (v1.2 complete)

| Layer | Capability |
|-------|------------|
| **Scoring** | Phoenix multi-action heads (proxy / hash sidecar / jax path) + WeightedScorer Σ wᵢ·Pᵢ |
| **Pipeline** | Filters, author diversity, OON factor, premium soft boost, grade A+–F |
| **Profiles** | balanced · conversation · media · news · viral · OSS demo |
| **A/B compare** | Same tweet under all profiles (`Alt+Shift+C`) |
| **Affinity** | Calibrate from engagement history JSON |
| **Sampler** | Opt-in likes import + **+HIST** buttons + auto on `/likes` |
| **Export** | CSV / JSON timeline scans & reports |
| **Sidecar** | Local Python server: score, validate, compare, calibrate |
| **Packaging** | `npm run build` → Chrome zip · GitHub Actions CI |

---

## Install (unpacked)

1. Clone: `git clone https://github.com/NanoMindExplorer/nano-algorithm-rank-validator.git`
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked**
3. Open [x.com](https://x.com) → purple **NΔ** FAB

### Shortcuts on x.com

| Keys | Action |
|------|--------|
| `Alt+Shift+N` | Validate |
| `Alt+Shift+C` | A/B profiles |
| `Alt+Shift+S` | Engagement sampler |

---

## Sidecar (optional)

```bash
python3 sidecar/server.py          # hash mode default
npm run sidecar                    # same
```

Options → enable sidecar → URL `http://127.0.0.1:8787` → mode `hash` → Test → Save.

JAX (advanced): unpack Phoenix artifacts from x-algorithm, then:

```bash
NARV_PHOENIX_MODE=jax \
NARV_ARTIFACTS_DIR=./artifacts \
NARV_PHOENIX_PATH=/path/to/x-algorithm/phoenix \
python3 sidecar/server.py
```

---

## Develop

```bash
npm test                 # node pipeline smoke
npm run build            # dist/nano-algorithm-rank-validator-v1.2.0.zip
npm run build:store      # zip without sidecar (store-oriented)
```

Algorithm mapping and honesty bounds: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md), [docs/RESEARCH.md](docs/RESEARCH.md).

---

## Privacy

- Runs locally in the browser on X pages  
- Engagement samples stay in `chrome.storage.local` until you export/clear  
- Sidecar binds to localhost only  
- No remote analytics backend  

---

## License

MIT (extension). Algorithm analysis derived from Apache-2.0 [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).  
Does **not** redistribute Phoenix model weights.

---

Built for researchers and creators who want **transparent, structure-faithful** validation against the open X algorithm.
