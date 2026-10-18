# Solana Token Intelligence Bot

Scanner token Solana sesuai permintaan melalui Telegram dan HTTP API. Kirim alamat mint Solana langsung (atau `/scan <mint>`) untuk laporan berbahasa Indonesia tentang distribusi holder, developer, smart money, momentum, risiko, dan perbandingan dengan benchmark tersimpan. Pesan biasa yang bukan alamat mint diabaikan.

**Status: MVP pengembangan.** Mode default menggunakan snapshot dan benchmark sintetis, bukan data pasar aktual. Integrasi GMGN CLI tersedia sebagai adapter awal; mapping respons live belum diuji dengan kredensial GMGN dan beberapa metrik belum tersedia.

## Mulai

Ikuti [tutorial instalasi lengkap](docs/installation.md) dari pemasangan tools, pembuatan bot Telegram, pengujian API, sampai menjalankan bot di server.

Jika Node.js dan pnpm sudah terpasang:

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

Bank smart wallet bersama, deteksi token runner, Discord, serta dukungan BSC/Ethereum/Robinhood Chain masih berupa rencana dan belum aktif pada kode saat ini. Lihat [rencana fitur](docs/roadmap.md) untuk mekanisme yang diusulkan dan [status instalasi](docs/installation.md#status-fitur-sebelum-instalasi) untuk fitur yang sudah dapat dijalankan.

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
| `GMGN_PROVIDER` | `mock` | `mock` atau `cli` |
| `GMGN_API_KEY` | kosong | Kredensial query CLI live |
| `DATABASE_URL` | contoh URL lokal | Persiapan integrasi persistence |
| `LOG_LEVEL` | `info` | Level log Pino |

`.env` diabaikan Git. Simpan token hanya di mesin aplikasi.

## API

```bash
curl --fail-with-body -X POST http://localhost:3000/scan \
  -H 'content-type: application/json' \
  -d '{"mint":"So11111111111111111111111111111111111111112"}'
```

JSON mencakup `snapshot`, `cohortSize`, `classification`, `historicalScore`, `similarWinRatePct`, `similarMedianReturn24hPct`, `metrics`, dan `warnings`. Pada mode mock, `snapshot.source` adalah `fixture`; mint input hanya mengganti alamat pada snapshot contoh.

## Skor

Skor adalah rata-rata tertimbang percentile terhadap cohort benchmark, bukan probabilitas profit. Jika cohort berisi kurang dari lima token, analisis memakai seluruh benchmark.

| Skor | Klasifikasi |
| --- | --- |
| 82-100 | SANGAT MENARIK |
| 66-81 | CUKUP MENARIK |
| 48-65 | NETRAL |
| 32-47 | KURANG MENARIK |
| 0-31 | RISIKO TINGGI |

Statistik outcome bawaan berasal dari fixture sintetis, belum merupakan backtest pasar tervalidasi.

## Batas MVP

- Tidak melakukan transaksi atau menggunakan private key wallet.
- Data diambil saat CA dikirim langsung atau melalui `/scan`; tidak ada monitoring harga atau alert otomatis.
- Adapter live hanya mengambil `token info`. Metrik belum terpetakan diisi nol, sehingga skor live belum layak dipakai untuk keputusan finansial.
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
