# Nano Algorithm Rank Validator

**Chrome extension** that validates and ranks posts on [X](https://x.com) against the open-source **For You** recommendation pipeline from [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).

> Name: **nano algorithm rank validator** · Short: **NARV** · Version **1.1.0**

![Manifest V3](https://img.shields.io/badge/MV3-ready-1d9bf0)
![Algorithm](https://img.shields.io/badge/x--algorithm-Phoenix%20WeightedScorer-a855f7)

---

## What it does

On `x.com` / `twitter.com`, NARV:

1. **Parses** tweets from the DOM (status page or timeline cards)
2. Runs a client-side **For You pipeline simulation**:
   - Feature / hydration extraction  
   - Pre- & post-**filters** (Age, Self, VF soft, muted keywords, …)  
   - **Phoenix multi-action** P(engagement) **proxy** (19+ signals)  
   - **WeightedScorer** `Σ weight_i × P_i` (port of Rust scorer structure)  
   - **Author diversity** exponential decay  
   - **OON** (out-of-network) factor  
3. Shows a **grade, score path, signal bars, filter report, and creator insights**
4. Supports **draft scoring**, **timeline scan ranking**, and **editable weights**

### Important honesty bound

Production **Phoenix** is a Grok-based transformer (JAX) with user engagement history and multi-GB embeddings. Exact production **weight magnitudes** live in a private `params` module and are **not** in the OSS repo.

NARV implements the **full public algorithm structure** and a transparent **proxy** for P(action). Every report is labeled accordingly. See [`docs/RESEARCH.md`](docs/RESEARCH.md).

---

## Install (unpacked)

1. Clone or copy this folder  
2. Chrome → `chrome://extensions` → enable **Developer mode**  
3. **Load unpacked** → select `nano-algorithm-rank-validator/`  
4. Open [https://x.com](https://x.com) and use the purple **NΔ** button (bottom-right)

### Shortcuts

| Action | How |
|--------|-----|
| Validate current tweet | `Alt`+`Shift`+`N` or popup **Validate** |
| Per-tweet button | Hover card → **NΔ RANK** |
| Timeline rank scan | Panel → **Scan timeline** |
| Draft score | Panel → **Score draft** |
| Weights | Extension **Options** page |

---

## Algorithm mapping

| OSS component | NARV module |
|---------------|-------------|
| `phoenix` multi-action outputs | `src/lib/phoenix-proxy.js` |
| `weighted_scorer.rs` / `ranking_scorer.rs` | `src/lib/weighted-scorer.js` |
| `author_diversity_scorer.rs` + OON | `src/lib/ranking-scorer.js` |
| `home-mixer/filters/*` | `src/lib/filters.js` |
| Snowflake AgeFilter | `src/lib/snowflake.js` |
| Weight / param names | `src/lib/weights.js` |
| End-to-end stages | `src/lib/pipeline.js` |

### Score formula (public)

```
combined = Σ (weight_i × P(action_i))
final    = offset_score(combined)
final   *= diversity_multiplier(author_position)   // if batch
final   *= oon_weight_factor                       // if out-of-network
```

Default weights (editable) emphasize **reply / conversation**, then share/quote/follow, then passive engagement; block/mute/report are strongly negative — consistent with scorer structure and historical hierarchy research.

Demo weights inside OSS `run_pipeline.py` (`fav=1, reply=0.5, rt=0.3, dwell=0.2`) are **toy** values for the mini model, not production.

---

## Project layout

```
nano-algorithm-rank-validator/
├── manifest.json
├── README.md
├── docs/RESEARCH.md          # Deep algorithm research notes
├── icons/
├── src/
│   ├── background/service-worker.js
│   ├── content/              # Injected on x.com
│   ├── popup/                # Extension popup
│   ├── options/              # Weight editor
│   ├── lib/                  # Algorithm ports + proxy
│   └── ui/                   # Side panel UI
└── test/smoke.html           # Offline pipeline smoke test
```

---

## Offline smoke test

Open `test/smoke.html` in a browser (or run the Node-free page locally) to exercise the scoring pipeline without Chrome APIs.

```bash
# optional quick check with a local static server
cd nano-algorithm-rank-validator && python3 -m http.server 8765
# then open http://127.0.0.1:8765/test/smoke.html
```

---

## Privacy

- Runs **locally** in the browser on X pages  
- **No** remote analytics backend  
- Settings stored in `chrome.storage.sync`  
- Only host permissions: `x.com` / `twitter.com`

---

## License

Extension code: MIT (or as you prefer for your fork).

Algorithm analysis derived from **Apache-2.0** [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).  
This project does **not** redistribute the Phoenix model weights or private params.

---

## v1.1 integrations

| Feature | Where |
|---------|--------|
| **Weight profiles** (balanced, conversation, media, news, viral, OSS demo) | Options → Weight profile · `src/lib/profiles.js` |
| **Affinity calibration** from engagement history JSON | Options → Affinity · `src/lib/affinity.js` · sample: `test/sample-history.json` |
| **CSV / JSON export** of timeline scans & reports | Side panel after scan · `src/lib/export.js` |
| **Phoenix sidecar** (local HTTP scores + auto fallback) | `sidecar/server.py` · Options toggle · `src/lib/sidecar.js` |

### Sidecar quick start

```bash
python3 sidecar/server.py
# http://127.0.0.1:8787
```

Enable in Options → **Phoenix sidecar** → Test connection → Save.  
If the sidecar is down, scoring falls back to the in-extension proxy automatically.

### Sample history import

Use `test/sample-history.json` in Options → Calibrate from history, then **Apply suggested profile**.

---

## Roadmap ideas

- [ ] Wire sidecar `NARV_PHOENIX_MODE=jax` to real Phoenix checkpoints  
- [ ] Auto-sample engagement from your own likes timeline (opt-in)  
- [ ] Graphite / CI packaging for Chrome Web Store zip  

---

Built for researchers and creators who want **transparent, structure-faithful** validation against the open X algorithm — not black-box “virality scores.”
