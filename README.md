# Nano Algorithm Rank Validator (NARV)

Ekstensi Chrome untuk **memvalidasi dan merangking post di X (Twitter)** — sebelum atau sesudah dipublikasikan — berdasarkan struktur open-source algoritma **For You** dari [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).

| | |
|---|---|
| **Versi** | 1.5.0 |
| **Creator** | [@Deadmouse_jpeg](https://x.com/Deadmouse_jpeg) |
| **Repo** | https://github.com/NanoMindExplorer/nano-algorithm-rank-validator |
| **Lisensi** | MIT |
| **Wiki dev/riset** | [wiki/](./wiki/Home.md) · [GitHub Wiki](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator/wiki) |

---

## Syarat akses (penting)

Tools **terkunci** sampai salah satu kondisi ini terpenuhi:

| Pengguna | Syarat |
|----------|--------|
| **Semua orang** | Login di x.com **dan** **follow** [@Deadmouse_jpeg](https://x.com/Deadmouse_jpeg) |

Jika terkunci, panel/popup menampilkan **Follow required** + tombol ke profil + **Saya sudah follow — cek ulang**.

> Skor di NARV adalah **simulasi transparan** (proxy browser / sidecar hash) yang mengikuti *formula & pipeline publik* algoritma X. **Bukan** skor production Phoenix resmi di server X.

---

## Daftar isi

1. [Fitur](#1-fitur)
2. [Instalasi](#2-instalasi)
3. [Unlock akses (follow / owner)](#3-unlock-akses-follow--owner)
4. [Antarmuka](#4-antarmuka)
5. [Skor draf sebelum post](#5-skor-draf-sebelum-post)
6. [Validasi tweet yang sudah ada](#6-validasi-tweet-yang-sudah-ada)
7. [Scan timeline](#7-scan-timeline)
8. [Cek shadowban / visibilitas akun](#8-cek-shadowban--visibilitas-akun)
9. [Tips pemulihan shadowban](#9-tips-pemulihan-shadowban)
10. [Mass unfollow](#10-mass-unfollow-timer--non-followers--whitelist)
11. [Membaca laporan skor](#11-membaca-laporan-skor)
12. [A/B profil bobot](#12-ab-profil-bobot)
13. [Pengaturan (Options)](#13-pengaturan-options)
14. [Affinity & sampler riwayat](#14-affinity--sampler-riwayat)
15. [Sidecar opsional](#15-sidecar-opsional)
16. [Ekspor](#16-ekspor)
17. [Shortcut keyboard](#17-shortcut-keyboard)
18. [Alur kerja yang disarankan](#18-alur-kerja-yang-disarankan)
19. [FAQ](#19-faq)
20. [Privasi](#20-privasi)
21. [Pengembang](#21-pengembang)

---

## 1. Fitur

| Fitur | Kegunaan |
|--------|----------|
| **Draft scorer** | Tes teks **sebelum** di-post |
| **Validate** | Analisis tweet live / status page |
| **Scan timeline** | Ranking banyak post yang terlihat di feed |
| **A/B profiles** | Bandingkan bobot conversation / media / viral / dll. |
| **19 Signals** | Breakdown P(action) + kontribusi weighted |
| **Filters** | Checklist Age, VF soft, muted keyword, link, dll. |
| **Sampler (+HIST)** | Kumpulkan riwayat engagement untuk affinity |
| **Shadowban check** | Search ban, suggestion ban, ghost/reply hide, risiko perilaku + tips sembuh |
| **Mass unfollow** | Timer per unfollow, non-follow-back only, whitelist, pause/stop, daily cap |
| **Export CSV/JSON** | Simpan scan & laporan |
| **Sidecar lokal** | Engine hash Python di `127.0.0.1:8787` (opsional) |

---

## 2. Instalasi

### Syarat

- Google Chrome / Chromium (Manifest V3)
- Akun X **login** di browser yang sama
- Follow [@Deadmouse_jpeg](https://x.com/Deadmouse_jpeg)

### Langkah

1. **Follow** (jika bukan owner): https://x.com/Deadmouse_jpeg  
2. Clone atau unduh repo:
   ```bash
   git clone https://github.com/NanoMindExplorer/nano-algorithm-rank-validator.git
   ```
3. Buka `chrome://extensions`
4. Aktifkan **Developer mode**
5. **Load unpacked** → pilih folder yang berisi `manifest.json`
6. Pastikan **Nano Algorithm Rank Validator** aktif
7. Buka [x.com](https://x.com), **refresh** halaman

### Verifikasi

- Ikon toolbar: brand mark mouse + Δ (neon)
- Tombol floating **NΔ** di kanan bawah x.com
- Hover tweet → **NΔ RANK**
- Popup / panel: status unlocked setelah follow (atau owner)

**Update versi:** di `chrome://extensions` klik **Reload**, lalu refresh x.com.

---

## 3. Unlock akses (follow / owner)

### Pengguna umum

1. Login di x.com  
2. Buka https://x.com/Deadmouse_jpeg → **Follow**  
3. Buka panel NARV atau popup  
4. Jika masih terkunci → **Saya sudah follow — cek ulang**  
5. Tools terbuka (hasil positif di-cache ±15 menit)

### Pemilik `@Deadmouse_jpeg`

1. Login di Chrome **sebagai** `@Deadmouse_jpeg`  
2. Reload extension + refresh x.com  
3. Buka panel → **otomatis unlock** (mode pemilik)  
4. Tidak perlu (dan tidak bisa) follow diri sendiri  

Verifikasi identitas memakai sesi X di tab (API `verify_credentials` / deteksi handle). Pastikan tab tidak memakai akun lain di account switcher.

---

## 4. Antarmuka

### Floating button (NΔ)

Kanan bawah di x.com → buka side panel.

### Side panel

| Kontrol | Fungsi |
|---------|--------|
| **Validate** | Skor tweet halaman / kartu utama |
| **Scan** | Skor semua tweet terlihat di timeline |
| **A/B profiles** | Bandingkan profil bobot |
| **Draft** | Skor sebelum post |
| **Sample hist** | Riwayat engagement + kalibrasi |
| **Shadowban** | Cek restriksi visibilitas + tips pemulihan |
| **Unfollow** | Mass unfollow non-followers + timer + whitelist |
| Tab **Report** | Ringkasan, grade, insights |
| Tab **19 Signals** | Probabilitas & kontribusi bobot |
| Tab **Filters** | Status filter pipeline |
| Tab **Pipeline** | Jejak tahap scoring |
| **⧉** | Salin laporan JSON |
| **✕** | Tutup |

### Tombol di kartu tweet

| Tombol | Fungsi |
|--------|--------|
| **NΔ RANK** | Validasi tweet itu (butuh unlock) |
| **+HIST** | Tambah ke sample history (jika diaktifkan di Options & sudah unlock) |

### Popup Chrome

Validate · Scan · A/B · Sampler · Open panel · Settings  
Popup juga menampilkan layar follow gate jika terkunci.

### Options

Profil bobot, affinity, muted keywords, sidecar, auto-sampler.  
Buka dari popup **All settings** atau detail ekstensi.

---

## 5. Skor draf sebelum post

1. Tulis di compose X (opsional)  
2. **NΔ** → **Draft**  
3. Edit teks di textarea NARV (otomatis terisi dari compose jika terdeteksi)  
4. Pilih **Media**: None / Image / Video (>5s) / Poll  
5. Pilih **Format**: Single / Thread / Reply / Quote  
6. **Score draft**  
7. Baca Report + 19 Signals + tips  

Draf belum punya likes/views nyata — skor mengandalkan konten, media, format, profil bobot, dan affinity.

**Tips:** pertanyaan/CTA untuk reply · media untuk VQV/photo · hindari spam/ALL CAPS · link eksternal sering menekan skor proxy.

---

## 6. Validasi tweet yang sudah ada

| Cara | Langkah |
|------|---------|
| Status URL | Buka post → **Validate** atau `Alt+Shift+N` |
| Timeline | Hover → **NΔ RANK** |
| Popup | Tab x.com aktif → **Validate active tweet** |

Data dari DOM (jika ada): teks, handle, verified, counts, media, umur (Snowflake ID).

---

## 7. Scan timeline

1. Scroll feed agar beberapa tweet termuat  
2. **Scan**  
3. Daftar diurutkan skor tertinggi → terendah  
4. Klik baris untuk laporan penuh  
5. **Export CSV** / **Export JSON**

---

## 8. Cek shadowban / visibilitas akun

“Shadowban” **bukan** nama fitur resmi X. Di praktik komunitas & tools, yang dicek biasanya:

| Jenis | Arti praktis |
|--------|----------------|
| **Search Suggestion Ban** | Handle tidak muncul di saran pencarian (typeahead / People) |
| **Search Ban** | Tweet tidak muncul di search `from:username` (meski ada di profil) |
| **Ghost Ban** | Reply “hilang” bagi non-follower / sulit terlihat di thread |
| **Reply deboost** | Reply masuk di balik “Show more replies” (sering perlu uji manual) |
| **Quality / behavior filter** | Reach turun karena pola spam, link, burst post, graf follow, dll. |

### Cara pakai di NARV

1. Unlock tools (follow / owner)  
2. Panel → **Shadowban** (atau popup → **Shadowban check**)  
3. Isi `@username` — atau kosongkan untuk profil yang sedang dibuka / akun aktif  
4. **Jalankan cek shadowban**  
5. Baca hasil per sinyal + tips pemulihan  
6. Opsional **Export JSON**

### Apa yang diuji otomatis (sesi login x.com)

1. **Profil** — ada / suspended / protected / withheld  
2. **Typeahead** — apakah `@user` muncul di saran search  
3. **Search `from:user`** — apakah ID tweet terbaru dari timeline muncul di hasil search  
4. **Heuristik ghost** — reply di timeline vs search `from:user filter:replies`  
5. **Behavioral risk** — rasio follow, burst posting, link/spam language, avatar default  

> Ghost ban & reply deboost paling akurat dikonfirmasi **manual** (akun non-follower / incognito). NARV memberi sinyal + panduan uji manual.

---

## 9. Tips pemulihan shadowban

NARV menampilkan tips **dinamis** sesuai temuan. Ringkasan praktik terbaik:

### Umum (lakukan dulu)

1. **Cooling 48–72 jam** — stop automation, mass like/RT/follow, burst posting.  
2. **Bersihkan konten** — hapus post yang di-report, spam, media sensitif, copy-paste massal.  
3. **Rapikan graf** — jangan buy followers; unfol bot perlahan; hentikan follow/unfollow massal.  
4. **Konten orisinal** — kurangi link di body (taruh di reply); balas manusiawi ke mutual.  
5. **Keamanan** — lengkapi avatar/bio, 2FA, cabut app pihak ketiga mencurigakan.  
6. **Appeal resmi** hanya jika X memberi notifikasi locked/limited — ikuti alur in-app/email.

### Khusus Search / Suggestion Ban

- Cool-down 72 jam tanpa hashtag stuffing & reply spam.  
- Lalu 3–5 post orisinal **tanpa link**, interaksi pelan.  
- Cek harian: search `from:yourhandle` + ketik handle di kotak search.

### Khusus Ghost / reply hide

- Hentikan reply massal 3–7 hari.  
- Reply hanya thread relevan, teks berbeda (bukan template).  
- Uji: dari akun non-follower, apakah reply kamu terlihat / di balik “Show more”.

### Uji manual (wajib untuk konfirmasi)

| Uji | Cara |
|-----|------|
| Search | Incognito / logout → `from:handle` + cuplikan teks tweet |
| Suggestion | Ketik handle di search box → cek daftar People |
| Reply | Akun non-follower buka thread yang kamu balas |

**Jangan:** bikin banyak akun baru, spam appeal, atau “engagement pods” — sering memperparah filter.

---

## 10. Mass unfollow (timer · non-followers · whitelist)

Alat bantu membersihkan following: **unfollow bertahap** dengan jeda yang kamu atur sendiri.

### Fitur

| Fitur | Keterangan |
|--------|------------|
| **Timer per unfollow** | Delay (detik) + jitter acak antar aksi |
| **Non-follow-back** | Hanya target yang kamu follow tapi **tidak** follow balik |
| **Whitelist** | Handle yang **tidak pernah** di-unfollow (teman, klien, brand) |
| **Skip** | Verified/Premium, protected, atau followers ≥ N |
| **Session / daily cap** | Batas per sesi & soft cap harian (lokal) |
| **Pause / Resume / Stop** | Kontrol penuh saat jalan |
| **Preview** | Scan dulu, pilih manual siapa yang di-unfollow |

### Cara pakai

1. Unlock NARV (follow `@Deadmouse_jpeg` / owner)  
2. Panel → **Unfollow** (atau popup → **Mass unfollow**)  
3. Atur **delay** (disarankan 30–60 dtk), jitter, max sesi, cap harian  
4. Isi **whitelist** (pisah koma): `@teman, @klien`  
5. **Simpan settings**  
6. **Scan following** (mengambil daftar following + followers — bisa 1–3 menit)  
7. Centang kandidat → **Mulai unfollow terpilih**  
8. Pantau progress; gunakan **Pause** / **Stop** bila perlu  

### Rekomendasi aman

- Delay **≥ 30–45 detik**/unfollow (default 45s + jitter)  
- **≤ 40** per sesi, **≤ 100–150** per hari  
- Jangan jalankan 24/7; stop jika HTTP **429**  
- Setelah mass unfollow, cek **Shadowban** di NARV  
- Whitelist selalu untuk akun penting  

> Unfollow massal agresif bisa memicu rate-limit atau filter visibilitas. Ini tool manajemen akun pribadi — gunakan bijak.

---

## 11. Membaca laporan skor

### Hero

| Elemen | Arti |
|--------|------|
| Angka 0–100 | Skor display ternormalisasi |
| Grade **A+ … F** | Estimasi potensi distribusi |
| Badge **proxy / sidecar** | Sumber P(action) |
| Badge **profil** | Mis. `conversation`, `media` |
| **Filters OK** | Lolos filter keras (client) |
| **In-network / OON** | Asumsi jaringan (default in-network) |

| Grade | Orientasi |
|-------|-----------|
| A+ / A | Kuat |
| B | Solid |
| C | Rata-rata — optimasi reply/media |
| D | Lemah |
| F | Buruk / pola spam / sinyal negatif |

### Tab lain

- **19 Signals** — P(action) dan `bobot × P`  
- **Filters** — Age, self, muted, soft external link, VF soft, …  
- **Pipeline** — hydration → filters → phoenix → weighted → diversity → OON → final  

---

## 12. A/B profil bobot

Skor **tweet yang sama** dengan set bobot berbeda.

**NΔ** → **A/B profiles** atau `Alt+Shift+C`

| Profil | Fokus |
|--------|--------|
| `balanced` | Default seimbang |
| `conversation` | Reply, quote, follow |
| `media` | VQV, photo expand, dwell |
| `news` | Click, share link |
| `viral` | Repost & share |
| `demo_pipeline` | Bobot toy demo OSS (riset) |

---

## 13. Pengaturan (Options)

| Bagian | Isi |
|--------|-----|
| **Weight profile** | Pilih profil → bobot ter-update → Save |
| **Viewer context** | In-network default, history affinity, muted keywords |
| **Affinity calibration** | Import JSON riwayat → calibrate → optional apply suggested profile |
| **Sidecar** | Enable, URL `http://127.0.0.1:8787`, mode hash/proxy/jax, test connection |
| **Auto-sampler** | Auto impor di `/likes`, tampilkan tombol +HIST |

Selalu **Save settings** setelah mengubah opsi.

Contoh JSON affinity:

```json
{
  "engagements": [
    { "text": "Topik yang saya suka", "liked": true, "replied": true },
    { "text": "Spam giveaway", "not_interested": true }
  ]
}
```

File contoh: [`test/sample-history.json`](./test/sample-history.json).

---

## 14. Affinity & sampler riwayat

| Cara | Langkah |
|------|---------|
| Halaman Likes | Buka `x.com/YOU/likes` → **Sample hist** → Import → Calibrate |
| Manual | Options: aktifkan +HIST → hover tweet → **+HIST** → Calibrate |
| JSON | Options → upload/paste → Calibrate |

**Export history JSON** / **Clear** tersedia di panel Sample hist.  
Data sample: `chrome.storage.local`.

---

## 15. Sidecar opsional

Tanpa sidecar: P(action) dihitung di browser (proxy).  
Dengan sidecar: heads dihitung di Python lokal (default **hash**).

```bash
python3 sidecar/server.py
# http://127.0.0.1:8787
```

Options → Enable sidecar → Test connection → Save.  
Jika sidecar mati → **fallback otomatis** ke proxy.

Detail API: [wiki/Sidecar.md](./wiki/Sidecar.md).

---

## 16. Ekspor

| Data | Cara |
|------|------|
| Satu laporan | Report → Download JSON / tombol ⧉ |
| Scan timeline | Export CSV / JSON |
| A/B compare | Export compare JSON |
| History samples | Sample hist → Export history JSON |

---

## 17. Shortcut keyboard

Di **x.com** (setelah unlock):

| Pintasan | Aksi |
|----------|------|
| `Alt`+`Shift`+`N` | Validate |
| `Alt`+`Shift`+`C` | A/B profiles |
| `Alt`+`Shift`+`S` | Sampler |

---

## 17. Alur kerja yang disarankan

### Creator (sebelum post)

```
Follow @Deadmouse_jpeg (atau login sebagai owner)
→ pilih profil di Options
→ Draft scorer → perbaiki tips
→ A/B profiles (opsional)
→ Post di X
→ Validate lagi setelah ada views (opsional)
```

### Analis feed

```
Unlock → Scan timeline → Export CSV → buka post top → 19 Signals
```

### Cek kesehatan akun

```
Unlock → Shadowban check (@handle) → baca temuan
→ terapkan tips pemulihan → uji manual → cek ulang 48–72 jam
```

---

## 18. FAQ

**Apakah skor = ranking resmi X?**  
Tidak. Production memakai model Phoenix + history viewer + bobot privat. NARV meniru struktur open-source dengan estimasi yang bisa diaudit.

**Saya @Deadmouse_jpeg tapi masih terkunci?**  
Pastikan login di tab itu sebagai `@Deadmouse_jpeg`, reload extension, refresh x.com, lalu **cek ulang**. Jangan pakai akun lain di switcher.

**Sudah follow tapi masih terkunci?**  
Login di tab yang sama, buka lagi profil creator, klik **cek ulang**. API X kadang butuh sesi segar.

**Kenapa draf bagus tapi post tidak viral?**  
Reach nyata = network, timing, history viewer lain, retrieval OON, safety server, eksperimen online — di luar klien.

**Link eksternal?**  
Di proxy, sering menekan skor; soft warning di filters.

**Extension tidak muncul?**  
Refresh x.com · Load unpacked ke folder yang benar · pastikan aktif di `chrome://extensions`.

**Shadowban check gagal / unknown?**  
Login di tab x.com, pastikan API search tidak di-rate-limit, coba lagi nanti. Gunakan juga uji manual di §9.

**Apakah “Clear” = 100% aman dari shadowban?**  
Tidak. Hanya sinyal yang bisa diukur otomatis. Reply deboost & eksperimen For You bisa tetap membatasi reach.

---

## 19. Privasi

- Berjalan lokal di browser pada domain X  
- Tidak ada backend analytics bawaan NARV  
- Preferensi: `chrome.storage.sync`  
- Sample engagement: `chrome.storage.local` (bisa di-clear)  
- Cek follow & shadowban memakai **sesi X yang sudah login** di tab (API web X)  
- Sidecar hanya listen localhost  

---

## 20. Pengembang

Dokumentasi build, arsitektur, API, dan riset:

| Topik | Path |
|--------|------|
| Home | [wiki/Home.md](./wiki/Home.md) |
| Development | [wiki/Development.md](./wiki/Development.md) |
| Architecture | [wiki/Architecture.md](./wiki/Architecture.md) |
| Integrations | [wiki/Integrations.md](./wiki/Integrations.md) |
| Sidecar | [wiki/Sidecar.md](./wiki/Sidecar.md) |
| Research | [wiki/Research.md](./wiki/Research.md) |
| Contributing | [wiki/Contributing.md](./wiki/Contributing.md) |

```bash
npm test                 # smoke pipeline
npm run sidecar          # server lokal
npm run build            # zip dist/
```

---

## Lisensi & kredit

- **Ekstensi:** MIT  
- **Creator / syarat follow:** [@Deadmouse_jpeg](https://x.com/Deadmouse_jpeg)  
- **Analisis algoritma:** diturunkan dari [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) (Apache-2.0)  
- Tidak mendistribusikan bobot model Phoenix production  

**Repo:** https://github.com/NanoMindExplorer/nano-algorithm-rank-validator  
**X:** https://x.com/Deadmouse_jpeg
