# Solana Token Intelligence Bot

Scanner token Solana sesuai permintaan melalui Telegram dan HTTP API. Kirim alamat mint Solana langsung (atau `/scan <mint>`) untuk laporan berbahasa Indonesia tentang distribusi holder, developer, smart money, momentum, risiko, dan perbandingan dengan benchmark tersimpan. Pesan biasa yang bukan alamat mint diabaikan.

**Status:** Telegram mendukung scan data live Solana melalui GMGN CLI dan pemantauan kandidat runner. Mode default `mock` hanya menampilkan pesan demo, tanpa skor atau win rate. Field yang tidak tersedia pada mode live bernilai `null`, bukan nol. Skor historis tidak diterbitkan karena benchmark riil belum terpasang.

Untuk mengaktifkan data nyata dan runner, ikuti [panduan live dan runner](docs/live-and-runner.md). Query token dan discovery sudah diuji dengan CLI resmi dan public demo key; untuk penggunaan bot, gunakan API key Anda sendiri.

## Mulai

Ikuti [tutorial instalasi lengkap](docs/installation.md) dari pemasangan tools, pembuatan bot Telegram, pengujian API, sampai menjalankan bot di server.

Siapkan Node.js 24 dan pnpm 11.25.0 terlebih dahulu melalui [langkah pemasangan tools](docs/installation.md#1-pasang-tools). pnpm 11 membutuhkan Node minimal 22.13. Setelah kedua tools tersedia:

```bash
git clone https://github.com/bltzkrgg/scanner-intelligence-bot.git
cd scanner-intelligence-bot
pnpm install --frozen-lockfile
cp .env.example .env
pnpm build
pnpm test
```

Isi `TELEGRAM_BOT_TOKEN` dari BotFather di `.env`, lalu jalankan:

```bash
pnpm telegram:dev
```

Buka chat bot, kirim `/start`, lalu kirim satu CA Solana tanpa `/scan`. Untuk mencoba HTTP API secara terpisah, jalankan `pnpm api:dev` di terminal lain.

Kedua script memuat `.env` dari root repo. Bot dan API adalah proses independen; bot memanggil scanner langsung sehingga API tidak perlu aktif untuk menggunakan Telegram.

## Rencana Berikutnya

Bank smart wallet bersama milik user, Discord, serta dukungan BSC/Ethereum/Robinhood Chain masih berupa rencana. Runner Solana memakai label smart money dari provider, bukan bank wallet user. Lihat [rencana fitur](docs/roadmap.md) dan [panduan runner](docs/live-and-runner.md).

## Komponen

| Lokasi | Fungsi |
| --- | --- |
| `apps/api` | Fastify, `POST /scan` |
| `apps/telegram` | grammY, `/start` dan `/scan` |
| `packages/gmgn` | Adapter snapshot fixture dan GMGN CLI |
| `packages/analysis` | Normalisasi, skor, klasifikasi, risiko |
| `packages/benchmark` | Cohort, percentile, token mirip |
| `packages/report` | Laporan Telegram |
| `packages/database` | Schema Drizzle dan helper PostgreSQL |
| `packages/shared` | Tipe, validasi, konfigurasi, logger |
| `research` | Dataset contoh dan script Python |
| `tests` | Pengujian analisis, laporan, dan riset |

## Konfigurasi

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `NODE_ENV` | `development` | Label environment |
| `PORT` | `3000` | Port API |
| `TELEGRAM_BOT_TOKEN` | kosong | Wajib untuk proses Telegram |
| `TELEGRAM_STARTUP_CHAT_ID` | kosong | Opsional: tujuan satu notifikasi setiap proses bot dimulai |
| `GMGN_PROVIDER` | `mock` | `mock` atau `cli` |
| `GMGN_API_KEY` | kosong | Kredensial query CLI live |
| `RUNNER_ENABLED` | `false` | Aktifkan worker runner; wajib provider `cli` dan admin IDs |
| `RUNNER_INTERVAL_SECONDS` | `300` | Jeda setelah siklus; minimum 60 detik |
| `RUNNER_STATE_FILE` | `data/runners.json` | File state persisten, satu proses penulis |
| `TELEGRAM_ADMIN_IDS` | kosong | User ID admin dipisahkan koma, tanpa spasi |
| `DATABASE_URL` | contoh URL lokal | Persiapan integrasi persistence |
| `LOG_LEVEL` | `info` | Level log Pino |

`.env` diabaikan Git. Simpan token hanya di mesin aplikasi.

Bot mendaftarkan menu perintah Telegram secara otomatis, termasuk `/runner`, `/runners`, `/runner_on`, `/runner_off`, dan `/runner_remove`. Bentuk tombol mengikuti aplikasi Telegram. `/chatid` menampilkan chat ID untuk notifikasi dan user ID untuk admin. Lihat [panduan menu dan notifikasi](docs/installation.md#menu-telegram-dan-notifikasi-startup).

## API

```bash
curl --fail-with-body -X POST http://localhost:3000/scan \
  -H 'content-type: application/json' \
  -d '{"mint":"So11111111111111111111111111111111111111112"}'
```

JSON mencakup `snapshot`, `cohortSize`, `classification`, `historicalScore`, `similarWinRatePct`, `similarMedianReturn24hPct`, `metrics`, dan `warnings`. `classification`, skor dan statistik historis default `null`. Pada mode mock snapshot masih merupakan fixture berlabel jelas dengan warning demo; Telegram hanya menampilkan pemberitahuan demo. HTTP 400 untuk input salah dan 502 untuk kegagalan provider. API tidak menjalankan worker runner; worker berjalan dalam proses Telegram.

## Skor

Mesin skor historis untuk riset tetap tersedia, tetapi scanner produksi tidak lagi memuat benchmark sintetis secara otomatis. Klasifikasi berikut hanya digunakan ketika layanan analisis secara eksplisit diberi benchmark riil dan semua metrik tersedia. Tidak ada fitur mengganti benchmark produksi lewat `.env` pada versi ini.

| Skor | Klasifikasi |
| --- | --- |
| 82-100 | SANGAT MENARIK |
| 66-81 | CUKUP MENARIK |
| 48-65 | NETRAL |
| 32-47 | KURANG MENARIK |
| 0-31 | RISIKO TINGGI |

Runner Score adalah rule momentum terpisah (bukan skor historis/probabilitas profit). Lihat [bobot dan syarat runner](docs/live-and-runner.md#aturan-kandidat).

## Batas MVP

- Tidak melakukan transaksi atau menggunakan private key wallet.
- Scan mengambil `token info` dan `token security`; cache per CA selama 30 detik.
- Worker opsional mengambil trending dan memperbarui kandidat tiap siklus. Belum ada alert transaksi atau broadcast kandidat otomatis.
- Metrik yang tidak memiliki padanan semantik tetap `null`; volume bundler tidak diperlakukan sebagai kepemilikan bundler.
- Runner menyimpan maksimal 50 kandidat, memantau 7 hari sejak deteksi. Harga puncak/drawdown adalah sampel yang teramati, bukan seluruh tick pasar.
- PostgreSQL belum terhubung ke proses scan; belum ada migrasi atau penyimpanan laporan ke database.
- API belum memiliki autentikasi atau rate limiting. Batasi akses server seperti pada tutorial.
- Validasi mint masih berdasarkan pola string base58, belum verifikasi on-chain.

## Pengembangan

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:python
pnpm research:build-dataset
pnpm research:label-outcomes
```

`build` memverifikasi kompilasi TypeScript. Jalankan aplikasi dengan script `api:dev` dan `telegram:dev`; `dist` belum disiapkan sebagai distribusi mandiri. Script lint masih membutuhkan konfigurasi ESLint.

Lihat [integrasi GMGN](docs/gmgn-integration.md) untuk data yang masih diperlukan.
