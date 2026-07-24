# Contributing

## Alur singkat

1. Fork / branch dari `master`
2. Ubah kode + tambah smoke coverage jika perlu
3. `node test/smoke-node.mjs` harus lulus
4. PR dengan deskripsi jelas (apa & mengapa)

## Style

- Content scripts: IIFE + `globalThis` (bukan bundler)
- Jaga urutan inject di `manifest.json`
- Label jujur: proxy vs sidecar vs production
- Jangan commit `dist/`, `__pycache__`, secret

## Area yang sering disentuh

| Area | Path |
|------|------|
| Scoring | `src/lib/weighted-scorer.js`, `phoenix-proxy.js` |
| UI panel | `src/ui/panel.js` |
| Options | `src/options/` |
| Sidecar | `sidecar/*.py` |
| Profil | `src/lib/profiles.js` |

## Dokumentasi

- **End-user usage** → `README.md` di root  
- **Dev / riset / API** → wiki ini  

Setelah mengubah perilaku user-facing, update README usage.  
Setelah mengubah arsitektur/API, update halaman wiki terkait.

## Lisensi

MIT (extension). Analisis algoritma dari Apache-2.0 [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).
