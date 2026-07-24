# Development

Dokumentasi pembangunan **Nano Algorithm Rank Validator** (NARV) v1.2.0.

> Panduan **penggunaan** extension untuk end-user ada di [README](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator#readme).

## Prerequisites

- Node.js ≥ 18 (untuk smoke test)
- Python 3.10+ (untuk sidecar)
- Google Chrome / Chromium (load unpacked)
- `git`, opsional: `gh` CLI

## Clone & load extension

```bash
git clone https://github.com/NanoMindExplorer/nano-algorithm-rank-validator.git
cd nano-algorithm-rank-validator
```

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode**
3. **Load unpacked** → pilih root repo (folder yang berisi `manifest.json`)
4. Buka https://x.com dan reload halaman jika content script belum aktif

## Scripts npm

```bash
npm test                 # Node smoke test (pipeline, profil, affinity, compare, export)
npm run sidecar          # Jalankan Phoenix sidecar di :8787
npm run build            # Build zip dist/nano-algorithm-rank-validator-vX.Y.Z.zip
npm run build:store      # Zip tanpa sidecar/scripts (orientasi Chrome Web Store)
```

Setara langsung:

```bash
node test/smoke-node.mjs
python3 sidecar/server.py
bash scripts/build-extension.sh
NARV_STORE_PACKAGE=1 bash scripts/build-extension.sh
```

## Struktur repo

```
nano-algorithm-rank-validator/
├── manifest.json              # Chrome MV3
├── README.md                  # Panduan penggunaan (end-user)
├── package.json
├── LICENSE
├── icons/
├── src/
│   ├── background/            # service worker + defaults storage
│   ├── content/               # inject di x.com
│   ├── popup/                 # popup toolbar
│   ├── options/               # halaman settings
│   ├── ui/                    # side panel + CSS
│   └── lib/                   # pipeline algorithm ports
├── sidecar/                   # HTTP scoring server (Python)
├── scripts/build-extension.sh
├── test/                      # smoke HTML + Node + sample history
├── docs/                      # pointer ke wiki
└── .github/workflows/ci.yml
```

### Modul `src/lib/`

| File | Peran |
|------|--------|
| `pipeline.js` | Orkestrator validateTweet / draft |
| `weights.js` | Default weights & param names |
| `profiles.js` | Profil bobot (conversation, media, …) |
| `phoenix-proxy.js` | Estimasi P(action) di browser |
| `weighted-scorer.js` | Σ weight × P (port Rust) |
| `ranking-scorer.js` | Diversity + OON + grade |
| `filters.js` | Checklist filter Age/VF/dll. |
| `affinity.js` | Kalibrasi history → affinity |
| `sampler.js` | Koleksi engagement opt-in |
| `compare.js` | A/B multi-profil |
| `export.js` | CSV / JSON |
| `sidecar.js` | Klien HTTP sidecar |
| `tweet-parser.js` | Parse DOM x.com |
| `snowflake.js` | Tweet ID → umur |
| `content-features.js` | Fitur teks/media |

## Testing

### Node smoke

```bash
node test/smoke-node.mjs
```

Memverifikasi: snowflake, scoring, grade, profiles, spam penalty, affinity, CSV, A/B compare, sampler shape.

### Browser smoke

Buka `test/smoke.html` via static server:

```bash
python3 -m http.server 8765
# http://127.0.0.1:8765/test/smoke.html
```

### Sidecar API smoke

```bash
python3 sidecar/server.py &
curl -s http://127.0.0.1:8787/health
curl -s -X POST http://127.0.0.1:8787/v1/validate \
  -H 'Content-Type: application/json' \
  -d '{"tweet":{"text":"What do you think?\n\nReply","hasImage":true},"profileId":"conversation"}'
```

### CI

GitHub Actions (`.github/workflows/ci.yml`):

1. `node test/smoke-node.mjs`
2. Start sidecar → hit `/health`, `/v1/validate`, `/v1/compare_profiles`
3. Validate `manifest.json`
4. Build zip artifact

## Packaging

```bash
bash scripts/build-extension.sh
# → dist/nano-algorithm-rank-validator-v1.2.0.zip
# → dist/….zip.sha256
```

`dist/` di-ignore oleh git.

## Sidecar modes (dev)

| Env | Mode |
|-----|------|
| `NARV_PHOENIX_MODE=hash` | Default multi-action deterministic |
| `NARV_PHOENIX_MODE=proxy` | Heuristik murni |
| `NARV_PHOENIX_MODE=jax` | Coba load artifact Phoenix + JAX |

```bash
NARV_PHOENIX_MODE=jax \
NARV_ARTIFACTS_DIR=/path/to/artifacts \
NARV_PHOENIX_PATH=/path/to/x-algorithm/phoenix \
python3 sidecar/server.py
```

Detail API: [[Sidecar]].

## Konvensi skor

- Formula publik: `Σ weight_i × P(action_i)` + offset + diversity + OON  
- Bobot produksi **tidak** ada di OSS; default NARV research-calibrated & editable  
- Label report selalu membedakan `proxy` vs `sidecar`

Lihat juga: [[Architecture]], [[Research]], [[Integrations]].
