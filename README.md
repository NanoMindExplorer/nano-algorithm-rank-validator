# Nano Algorithm Rank Validator (NARV)

Ekstensi Chrome untuk **memvalidasi dan merangking post X (Twitter)** sebelum atau sesudah dipublikasikan, berdasarkan struktur algoritma open-source **For You** dari [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).

**Versi:** 1.2.0 · **Lisensi:** MIT  
**Wiki (pengembang & riset):** [GitHub Wiki](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki)

> Skor yang ditampilkan adalah **simulasi transparan** (proxy / sidecar hash) yang mengikuti *formula dan pipeline publik* algoritma X — **bukan** skor production Phoenix resmi di server X.

---

## Daftar isi

1. [Apa yang bisa dilakukan](#1-apa-yang-bisa-dilakukan)
2. [Instalasi](#2-instalasi)
3. [Antarmuka singkat](#3-antarmuka-singkat)
4. [Skor draf sebelum post (paling penting)](#4-skor-draf-sebelum-post-paling-penting)
5. [Validasi tweet yang sudah ada](#5-validasi-tweet-yang-sudah-ada)
6. [Scan & ranking timeline](#6-scan--ranking-timeline)
7. [Membaca laporan skor](#7-membaca-laporan-skor)
8. [A/B bandingkan profil bobot](#8-ab-bandingkan-profil-bobot)
9. [Pengaturan (Options)](#9-pengaturan-options)
10. [Kalibrasi affinity & sampler riwayat](#10-kalibrasi-affinity--sampler-riwayat)
11. [Sidecar opsional (lebih konsisten)](#11-sidecar-opsional-lebih-konsisten)
12. [Ekspor data](#12-ekspor-data)
13. [Shortcut keyboard](#13-shortcut-keyboard)
14. [Alur kerja yang disarankan](#14-alur-kerja-yang-disarankan)
15. [FAQ & batasan](#15-faq--batasan)
16. [Privasi](#16-privasi)
17. [Bantuan pengembang](#17-bantuan-pengembang)

---

## 1. Apa yang bisa dilakukan

| Fitur | Kapan dipakai |
|--------|----------------|
| **Draft scorer** | Mengetes teks *sebelum* di-post |
| **Validate tweet** | Menganalisis post yang sudah live / milik orang lain |
| **Scan timeline** | Membandingkan banyak post di feed |
| **A/B profiles** | Melihat profil bobot mana yang “menghargai” konten Anda |
| **+HIST / sampler** | Mengumpulkan riwayat engagement untuk kalibrasi |
| **Export CSV/JSON** | Menyimpan hasil scan / laporan |
| **Sidecar lokal** | Menjalankan engine hash di Python (opsional) |

---

## 2. Instalasi

### Syarat

- Google Chrome atau Chromium (Manifest V3)
- Akun/browser yang bisa membuka [x.com](https://x.com)

### Langkah

1. Unduh atau clone repositori:
   ```bash
   git clone https://github.com/NanoMindExplorer/nano-algorithm-rank-validator.git
   ```
2. Buka Chrome → alamat `chrome://extensions`
3. Aktifkan **Developer mode** (kanan atas)
4. Klik **Load unpacked**
5. Pilih folder project yang berisi file `manifest.json`
6. Pastikan ekstensi **Nano Algorithm Rank Validator** aktif
7. Buka [https://x.com](https://x.com) (atau refresh jika sudah terbuka)

### Verifikasi

- Di pojok kanan bawah x.com muncul tombol bulat ungu **NΔ**
- Saat hover sebuah tweet, muncul tombol **NΔ RANK** (dan opsional **+HIST**)
- Klik ikon ekstensi di toolbar Chrome → popup NARV menampilkan status **Connected** bila tab aktif adalah x.com

Jika tombol tidak muncul: refresh halaman x.com, pastikan ekstensi tidak di-disable untuk situs itu.

---

## 3. Antarmuka singkat

### A. Floating button (NΔ)

Di halaman x.com, kanan bawah. Membuka **side panel** validator.

### B. Side panel

Panel kanan berisi:

| Kontrol | Fungsi |
|---------|--------|
| **Validate** | Skor tweet di halaman status / kartu utama |
| **Scan** | Skor semua tweet yang terlihat di timeline |
| **A/B profiles** | Bandingkan satu tweet di banyak profil bobot |
| **Draft** | Skor teks *sebelum* post |
| **Sample hist** | Kelola riwayat engagement untuk affinity |
| Tab **Report** | Ringkasan skor & insights |
| Tab **19 Signals** | Probabilitas tiap aksi + kontribusi bobot |
| Tab **Filters** | Lolos/gagal filter pipeline |
| Tab **Pipeline** | Jejak tahap scoring |
| **⧉** (header) | Salin laporan JSON |
| **✕** | Tutup panel |

### C. Tombol di kartu tweet

| Tombol | Muncul saat | Fungsi |
|--------|-------------|--------|
| **NΔ RANK** | Hover tweet | Validasi tweet itu |
| **+HIST** | Hover (jika diaktifkan di Options) | Tambah ke riwayat “liked sample” |

### D. Popup toolbar Chrome

Klik ikon ekstensi:

- Validate active tweet  
- Scan visible timeline  
- A/B profile compare  
- Engagement sampler  
- Open side panel  
- All settings (Options)

### E. Halaman Options

Klik kanan ikon ekstensi → **Options**, atau dari popup **All settings**.  
Di sini Anda mengatur profil bobot, affinity, sidecar, dan sampler.

---

## 4. Skor draf sebelum post (paling penting)

Fitur ini untuk **mengetes ranking potensial sebelum Anda menekan Post**.

### Langkah demi langkah

1. Buka x.com → klik **Post** / compose (boleh tulis dulu di kotak tulis X).
2. Klik **NΔ** (atau popup → Open side panel).
3. Klik **Draft**.
4. Area teks:
   - Otomatis terisi dari compose box X jika terdeteksi, **atau**
   - Tempel / ketik manual di textarea NARV.
5. Atur **Media** (simulasi lampiran):
   - None  
   - Image / GIF  
   - Video (>5s) — mengaktifkan bobot VQV  
   - Poll  
6. Atur **Format**:
   - Single post  
   - Thread  
   - Reply  
   - Quote  
7. Klik **Score draft**.
8. Baca tab **Report**, **19 Signals**, **Filters**, **Pipeline**.

### Apa yang dihitung pada draf?

Karena post **belum live**, tidak ada likes/views nyata. Skor mengandalkan:

- Isi teks (pertanyaan, CTA, panjang, struktur baris)
- Sinyal spam / teriakan ALL CAPS
- Link eksternal
- Media & format yang Anda pilih
- Profil bobot aktif + affinity Anda

### Tips memakai Draft scorer

| Tujuan | Yang dicoba di draf |
|--------|---------------------|
| Naikkan peluang reply | Pertanyaan jujur, CTA, spasi baris, thread |
| Media / video | Pilih Video >5s atau Image di form Draft |
| Hindari penalti | Kurangi spam words, ALL CAPS, link di body |
| Bandingkan 2 versi | Skor versi A → ubah teks → skor lagi → bandingkan grade |

### Alur disarankan sebelum post

```
Tulis draf → Draft scorer → perbaiki tips merah/oranye
→ A/B profiles (opsional) → pilih sudut konten
→ Post di X → Validate lagi setelah ada views (opsional)
```

---

## 5. Validasi tweet yang sudah ada

### Dari halaman status

1. Buka URL post, contoh: `https://x.com/username/status/123…`
2. **NΔ** → **Validate**, atau `Alt+Shift+N`
3. Laporan muncul di panel

### Dari timeline / feed

1. Hover kartu tweet
2. Klik **NΔ RANK**
3. Panel membuka laporan untuk tweet itu

### Dari popup

1. Pastikan tab aktif menampilkan tweet yang dimaksud
2. Popup → **Validate active tweet**

Data yang dibaca dari DOM (jika tersedia): teks, handle, verified, counts (like/reply/repost/view), indikasi media, umur post (dari Snowflake ID).

---

## 6. Scan & ranking timeline

1. Scroll feed agar beberapa tweet termuat di layar  
2. Panel → **Scan** (atau popup **Scan visible timeline**)  
3. NARV menskor semua `article[data-testid="tweet"]` yang terlihat  
4. Daftar diurutkan skor tertinggi → terendah  
5. Klik baris untuk laporan penuh  
6. **Export CSV** / **Export JSON** untuk arsip  

Berguna untuk: membandingkan performa potensial post di For You vs sekitarnya (secara relatif, di client).

---

## 7. Membaca laporan skor

### Hero score

| Elemen | Arti |
|--------|------|
| Angka 0–100 | Skor final ternormalisasi (display) |
| Huruf **A+ … F** | Grade kasar potensi distribusi |
| Badge **Phoenix proxy** / **Sidecar** | Sumber P(action) |
| Badge **profil** | Mis. `conversation`, `media` |
| **Filters OK** / risiko | Lolos filter keras atau tidak |
| **In-network / OON** | Asumsi jaringan (default in-network) |

### Grade (orientasi)

| Grade | Arti praktis |
|-------|----------------|
| A+ / A | Kuat untuk kandidat distribusi |
| B | Solid, masih bisa dioptimasi |
| C | Rata-rata — perbaiki reply/media |
| D | Lemah — risiko reach rendah |
| F | Buruk / pola spam / sinyal negatif |

### Tab Report

- Preview teks & metrik  
- **Top positive drivers** — aksi yang paling mendorong skor (mis. reply × bobot tinggi)  
- **Negative / risk drivers** — report, mute, not interested, dll.  
- **Insights** — strengths / risks / tips berbahasa manusia  
- **Content features** — conversation, media, structure, freshness  

### Tab 19 Signals

Dua blok:

1. **P(action)** — estimasi probabilitas tiap aksi  
2. **Weighted contributions** — `bobot × probabilitas` (yang benar-benar masuk rumus)

### Tab Filters

Checklist mirip filter home-mixer (Age, Self, muted keywords, soft external link, VF heuristik, dll.).  
`null`/unknown = butuh data server (mis. “sudah pernah dilihat”).

### Tab Pipeline

Jejak tahap: hydration → filters → phoenix → weighted → diversity → OON → final.

---

## 8. A/B bandingkan profil bobot

Skor **tweet yang sama** dengan beberapa set bobot (bukan mengubah teks).

1. Buka tweet / pastikan konteks aktif  
2. Panel → **A/B profiles** atau `Alt+Shift+C`  
3. Lihat ranking profil: mana yang memberi skor tertinggi  
4. Opsional **Export compare JSON**

### Arti profil bawaan

| Profil | Fokus optimasi |
|--------|----------------|
| **balanced** | Default seimbang |
| **conversation** | Reply, quote, follow (bagus untuk pertanyaan & thread) |
| **media** | Video quality view, photo expand, dwell |
| **news** | Click, share link, quote |
| **viral** | Repost & share cascade |
| **demo_pipeline** | Bobot toy dari demo OSS (riset, bukan produksi) |

Jika “conversation” menang jauh di atas “media”, konten Anda lebih “dibaca” sebagai pemicu diskusi daripada konten visual (pada bobot default NARV).

---

## 9. Pengaturan (Options)

Buka **Options** dari popup atau `chrome://extensions` → Details → Extension options.

### Weight profile

Klik kartu profil → bobot di form ter-update → **Save settings**.

### Viewer context

| Opsi | Fungsi |
|------|--------|
| **Assume in-network** | Post diasumsikan dari akun yang di-follow (OON factor = 1) |
| **History affinity (0–1)** | Seberapa “kenal” model proxy dengan preferensi Anda |
| **Muted keywords** | Daftar kata (koma) untuk simulasi MutedKeywordFilter |

### Affinity calibration

1. Upload / paste JSON riwayat engagement  
2. **Calibrate from history**  
3. Opsional **Apply suggested profile**  
4. **Save settings**

Contoh format sederhana:

```json
{
  "engagements": [
    { "text": "Topik yang saya suka", "liked": true, "replied": true, "author": "someone" },
    { "text": "Spam giveaway", "not_interested": true }
  ]
}
```

File contoh di repo: `test/sample-history.json`.

### Phoenix sidecar

| Opsi | Fungsi |
|------|--------|
| Enable sidecar | Pakai server lokal untuk P(action) |
| Base URL | Default `http://127.0.0.1:8787` |
| Engine mode | `hash` (disarankan) / `proxy` / `jax` |
| Test connection | Cek `/health` |

### Engagement auto-sampler

| Opsi | Fungsi |
|------|--------|
| Auto-sample on /likes | Saat buka halaman likes, impor otomatis (setelah delay) |
| Show +HIST buttons | Tampilkan tombol sampel di hover tweet |

Jangan lupa **Save settings** setelah mengubah opsi.

---

## 10. Kalibrasi affinity & sampler riwayat

Agar skor lebih “dekat” dengan preferensi Anda (masih di level proxy, bukan model production):

### Cara A — halaman Likes

1. Buka `https://x.com/USERNAME/likes`  
2. Scroll agar banyak post termuat  
3. Panel → **Sample hist** → **Import visible likes**  
4. **Calibrate affinity**  
5. (Opsional) Options → Apply suggested profile → Save  

### Cara B — manual per tweet

1. Aktifkan **Show +HIST buttons** di Options  
2. Hover tweet → **+HIST**  
3. Ulangi, lalu **Sample hist** → Calibrate  

### Cara C — JSON

Import di Options (lihat §9).

### Kelola sampel

Di **Sample hist**:

- **Export history JSON** — backup  
- **Clear** — hapus semua sampel lokal  

Sampel disimpan di `chrome.storage.local` (per browser/profil Chrome).

---

## 11. Sidecar opsional (lebih konsisten)

Tanpa sidecar, semua skor P(action) dihitung **di dalam browser** (proxy).  
Dengan sidecar, heads dihitung di proses Python lokal (mode **hash** default).

### Menjalankan sidecar

Di folder repo:

```bash
python3 sidecar/server.py
```

Harus muncul: `NARV Phoenix sidecar v1.2.0 on http://127.0.0.1:8787`.

### Menghubungkan ke ekstensi

1. Options → centang **Enable sidecar**  
2. URL `http://127.0.0.1:8787`  
3. Mode **hash**  
4. **Test connection** → harus OK  
5. **Save settings**  

Jika sidecar mati, NARV **otomatis fallback** ke proxy in-page (badge “Sidecar fallback” bisa muncul).

Dokumentasi API & mode jax: [Wiki · Sidecar](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Sidecar).

---

## 12. Ekspor data

| Data | Cara |
|------|------|
| Laporan satu tweet | Tab Report → **Download report JSON**, atau ⧉ copy |
| Hasil scan timeline | Setelah Scan → **Export CSV** / **Export JSON** |
| Hasil A/B | Setelah compare → **Export compare JSON** |
| Riwayat engagement | Sample hist → **Export history JSON** |

CSV cocok untuk spreadsheet; JSON untuk arsip lengkap / analisis lanjutan.

---

## 13. Shortcut keyboard

Berlaku di halaman **x.com** / twitter.com:

| Pintasan | Aksi |
|----------|------|
| `Alt` + `Shift` + `N` | Validate tweet aktif |
| `Alt` + `Shift` + `C` | A/B profile compare |
| `Alt` + `Shift` + `S` | Panel engagement sampler |

---

## 14. Alur kerja yang disarankan

### Creator — sebelum posting

1. Set profil di Options (**conversation** jika ingin diskusi, **media** jika video-first).  
2. (Opsional) calibrate affinity dari likes Anda.  
3. Tulis draf di X → **Draft** → Score draft.  
4. Perbaiki tips (CTA, media, link, spam).  
5. **A/B profiles** untuk melihat sudut bobot mana yang unggul.  
6. Post → setelah ada views, **Validate** lagi untuk melihat skor dengan engagement nyata.

### Analis — audit feed

1. Buka For You / Following.  
2. **Scan** → urutkan skor.  
3. Export CSV.  
4. Buka post menarik → Report + 19 Signals.

### Power user

1. Jalankan sidecar hash.  
2. Aktifkan di Options.  
3. Sampler likes + calibrate.  
4. Bandingkan draf di beberapa profil; simpan JSON.

---

## 15. FAQ & batasan

### Apakah skor = ranking resmi di X?

**Tidak.** Production memakai model Phoenix (Grok-based) + history user + bobot privat yang tidak dipublikasikan. NARV meniru **struktur** open-source (multi-action, weighted sum, diversity, OON, filter) dengan estimasi yang bisa diaudit.

### Kenapa draf saya dapat grade bagus tapi post tidak viral?

Reach nyata bergantung pada network, timing, history viewer lain, retrieval OON, safety server, dan eksperimen online X — semuanya di luar klien.

### Kenapa angka berubah setelah ganti profil?

Profil mengubah **bobot** (prioritas aksi), bukan teks. Reply bisa jauh lebih mahal di profil conversation.

### Link eksternal selalu “buruk”?

Di model proxy, link eksternal sering menekan distribusi OON. Itu soft signal di filter + penalti kualitas, bukan sensor.

### Extension tidak jalan

- Refresh x.com  
- Pastikan Load unpacked ke folder yang benar (`manifest.json` di root)  
- Cek console halaman untuk `[NARV]`  
- Popup harus “Connected” di tab x.com  

### Sidecar “Offline”

- Pastikan `python3 sidecar/server.py` masih jalan  
- URL tepat `http://127.0.0.1:8787`  
- Tidak diblok extension lain / firewall lokal  

---

## 16. Privasi

- Berjalan **lokal** di browser Anda di domain X  
- **Tidak** ada backend analytics bawaan NARV  
- Preferensi: `chrome.storage.sync`  
- Sampel engagement: `chrome.storage.local` (bisa di-clear)  
- Sidecar hanya listen di localhost  

---

## 17. Bantuan pengembang

Dokumentasi pembangunan, arsitektur, API sidecar, dan riset algoritma dipindah ke **Wiki**:

| Topik | Tautan |
|--------|--------|
| Beranda wiki | [Wiki Home](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki) |
| Development / test / build / CI | [Development](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Development) |
| Architecture | [Architecture](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Architecture) |
| Integrations map | [Integrations](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Integrations) |
| Sidecar API | [Sidecar](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Sidecar) |
| Research x-algorithm | [Research](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Research) |
| Contributing | [Contributing](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki/Contributing) |

---

## Lisensi & kredit

- **Ekstensi:** MIT  
- **Analisis algoritma:** diturunkan dari [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) (Apache-2.0)  
- Tidak mendistribusikan bobot model Phoenix production  

**Repo:** https://github.com/NanoMindExplorer/nano-algorithm-rank-validator
