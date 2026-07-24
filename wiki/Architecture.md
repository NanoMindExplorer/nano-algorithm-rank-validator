# Architecture

Arsitektur NARV dan pemetaan ke open-source X For You algorithm.

## High-level

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
                                    │ optional HTTP (localhost)
                                    ▼
┌──────────────────── Local Phoenix Sidecar (Python) ────────────────────────────┐
│  modes: proxy | hash | jax                                                      │
│  /v1/score · /v1/validate · /v1/compare_profiles · /v1/calibrate                │
│  weighted_engine.py ≈ home-mixer RankingScorer                                  │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Pipeline For You (referensi OSS)

Dari [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm):

```
Query Hydration → Candidate Sources (Thunder + Phoenix Retrieval)
→ Hydration → Pre-Filters → Phoenix Scorer → Weighted Scorer
→ Author Diversity → OON Scorer → Top-K → Post-Selection Filters
```

| Komponen OSS | Peran | Cerminan di NARV |
|--------------|--------|------------------|
| Home Mixer | Orkestrasi | `pipeline.js` |
| Thunder | In-network candidates | Konteks `inNetwork` (simulasi) |
| Phoenix Retrieval | OON two-tower | Tidak dijalankan (server-side) |
| Phoenix Ranker | Multi-action P(action) | `phoenix-proxy.js` / sidecar |
| WeightedScorer | Σ w·P | `weighted-scorer.js` + `weighted_engine.py` |
| Author diversity | Decay per author | `ranking-scorer.js` |
| OON scorer | Factor &lt; 1 untuk OON | `oonWeightFactor` |
| Filters | Age, self, VF, … | `filters.js` |
| Grox | Safety / spam | Soft heuristics only |

## Multi-action heads

Phoenix memprediksi banyak aksi (bukan satu skor relevansi):

**Positif:** favorite, reply, retweet, quote, click, profile_click, photo_expand, vqv, share*, dwell*, follow_author  

**Negatif:** not_interested, block_author, mute_author, report, not_dwelled  

## Scoring formula (publik)

```
combined = Σ (weight_i × P_i)
offset   = f(combined, negative/total weight sums)
final    ≈ normalize(offset) × diversity × oon × soft_premium
```

VQV weight = 0 kecuali post punya video di atas `minVideoDurationMs`.

## UI surfaces

| Surface | File | Fungsi |
|---------|------|--------|
| Side panel | `src/ui/panel.js` | Validasi, scan, draft, A/B, sample |
| Popup | `src/popup/` | Shortcut actions |
| Options | `src/options/` | Weights, profil, sidecar, sampler |
| Tweet buttons | inject DOM | `NΔ RANK`, `+HIST` |

## Storage

| Key | Area | Isi |
|-----|------|-----|
| weights, params, profileId, … | `chrome.storage.sync` | Preferensi |
| affinityCalibration | sync | Hasil kalibrasi |
| engagementSamples | `chrome.storage.local` | History sampler |

## Honesty bounds

- Production Phoenix: model besar + history user + bobot privat  
- NARV: struktur pipeline publik + proxy/hash; **bukan** bit-exact production rank  

Lanjut: [[Research]] · [[Integrations]] · [[Development]]
