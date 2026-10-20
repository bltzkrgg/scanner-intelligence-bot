# Token Intelligence Bot

Scanner token Solana, BSC, dan Robinhood Chain (RH) melalui Telegram dan HTTP API. Kirim CA langsung atau `/scan <chain> <CA>`. Untuk alamat EVM tanpa chain, bot menampilkan tombol BSC/RH. Pesan biasa diabaikan.

Laporan Telegram kini ringkas, dengan CA monospace, angka K/M/B, waktu WIB, dan tombol Refresh, Detail Risiko, Status Runner, GMGN, Explorer, serta Salin CA. Lihat [panduan laporan dan tombol](docs/telegram-reports.md). Refresh memperbarui pesan yang sama melalui query provider baru, bukan sekadar mengganti timestamp.

Notifikasi ONLINE/OFFLINE memakai chat startup yang sama. Monitor heartbeat independen tersedia untuk gangguan proses/polling; jalankan di mesin lain untuk mendeteksi server bot mati. Ikuti [panduan lifecycle dan monitor PM2](docs/bot-lifecycle.md), termasuk secret health dan `.env.monitor`.

Jika notifikasi tidak muncul: jalankan `pnpm telegram:check`, atau admin kirim `/notification_test` lalu `/status`. Tersedia `ecosystem.config.cjs` agar PM2 memakai cwd, entry point dan `.env` yang benar; [langkah diagnosis](docs/bot-lifecycle.md#diagnosis-notifikasi-tidak-muncul) tidak memerlukan membagikan token.

**Status:** scan live dan pemantauan runner pada ketiga jaringan, dengan notifikasi Telegram untuk kandidat baru dan milestone 2x/5x teramati. Dukungan data aktual mengikuti akses GMGN. Mode default `mock` hanya pesan demo, tanpa skor atau win rate. Field tidak tersedia bernilai `null`. Skor historis belum diterbitkan karena benchmark riil belum terpasang.

Untuk mengaktifkan data nyata dan runner, ikuti [panduan live dan runner](docs/live-and-runner.md). Query token dan discovery sudah diuji dengan CLI resmi dan public demo key; untuk penggunaan bot, gunakan API key Anda sendiri.

Untuk BSC/RH dan notifikasi, ikuti [aktivasi multichain dan alert](docs/multichain-and-alerts.md). File state Solana lama dimigrasikan otomatis tanpa mengirim ulang alert kandidat lama.

Admin kini bisa mengubah filter Solana/BSC/RH dengan `/setconfig` tanpa restart, melihat `/getconfig`, dan menerima alert volume spike Solana/BSC. Fees mengikuti native chain: SOL/BNB/ETH. Daftar key, default, aktivasi PM2 dan contoh pesan ada di [pengaturan runner Telegram](docs/runner-config.md). Kebutuhan tambahan data risiko GMGN dicatat di [backlog pengayaan data](docs/gmgn-enrichment-backlog.md), belum diklaim selesai.

Alert volume tanpa batas umur kini tersedia untuk Solana, BSC, dan Robinhood: default volume rolling 5 menit >= $150K, likuiditas >= $10K, tanpa syarat fees/umur/market cap. Ada status volume tinggi, crossing, dan spike dengan baseline terukur; cooldown default 60 menit per chain+CA. Berlaku pada hasil discovery dan token tersimpan, bukan jaminan cakupan seluruh pasar. Lihat [alert volume token lama](docs/old-token-volume.md) untuk konfigurasi dan upgrade.

Notifikasi runner memakai teks tebal MARKET / ACTIVITY / STATUS tanpa kotak copy, Flow 5m jika tersedia (fallback 1h berlabel), N/A untuk data kosong, dan tombol GMGN / Detail Runner / Salin CA. Footer waktu/Ref dihapus; peringatan tertunda dan risiko spesifik tetap tampil. Tombol explorer dan Refresh tidak muncul pada alert runner; laporan scan biasa tetap memiliki tombolnya. Lihat [format alert runner](docs/runner-alert-format.md).

Scan CA dan runner mendukung enrichment opsional Solana Tracker, Helius, MadeOnSol dan FOMO. Isi key di `.env`; lihat [instalasi, cakupan dan batasan provider](docs/providers.md). MadeOnSol menampilkan jumlah token/bonding Solana serta graduation Robinhood dengan key yang sama; riwayat rug developer tidak dipakai dalam laporan atau skor.

Pengiriman runner kini diperiksa setelah tiap observasi tersimpan, bukan setelah semua chain selesai. `/status` menampilkan durasi siklus; lihat [penyebab dan batas latensi](docs/runner-latency.md).

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

Bank smart wallet bersama milik user, Discord, dan Ethereum masih berupa rencana. Runner memakai label smart money provider, bukan bank wallet user. Lihat [rencana fitur](docs/roadmap.md) dan [panduan runner](docs/live-and-runner.md).

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
| `TELEGRAM_STARTUP_CHAT_ID` | kosong | Tujuan ONLINE setiap startup dan OFFLINE saat penghentian normal |
| `TELEGRAM_RUNNER_CHAT_ID` | kosong | Tujuan alert kandidat baru dan milestone 2x/5x; terpisah dari startup |
| `ENABLED_CHAINS` | `sol,bsc,robinhood` | Jaringan scan dan worker yang diaktifkan |
| `GMGN_PROVIDER` | `mock` | `mock` atau `cli` |
| `GMGN_API_KEY` | kosong | Kredensial query CLI live |
| `RUNNER_ENABLED` | `false` | Aktifkan worker runner; wajib provider `cli` dan admin IDs |
| `RUNNER_INTERVAL_SECONDS` | `300` | Legacy, tidak lagi mengatur worker; semua chain memakai `/getconfig` (default 60 detik) |
| `RUNNER_STATE_FILE` | `data/runners.json` | File state persisten, satu proses penulis |
| `TELEGRAM_ADMIN_IDS` | kosong | User ID admin dipisahkan koma, tanpa spasi |
| `DATABASE_URL` | contoh URL lokal | Persiapan integrasi persistence |
| `LOG_LEVEL` | `info` | Level log Pino |
| `BOT_SHUTDOWN_TIMEOUT_SEC` | `25` | Batas shutdown 10-120 detik; kill timeout supervisor harus lebih lama |
| `BOT_HEALTH_ENABLED` | `false` | Aktifkan endpoint heartbeat terautentikasi |
| `BOT_HEALTH_HOST` / `BOT_HEALTH_PORT` | `127.0.0.1` / `3101` | Binding endpoint; default lokal saja |
| `BOT_HEALTH_TOKEN` | kosong | Secret minimal 32 karakter; wajib jika health aktif |

`.env` diabaikan Git. Simpan token hanya di mesin aplikasi.

Bot mendaftarkan menu perintah Telegram secara otomatis, termasuk `/runner`, `/runners`, `/runner_on`, `/runner_off`, dan `/runner_remove`. Bentuk tombol mengikuti aplikasi Telegram. `/chatid` menampilkan chat ID untuk notifikasi dan user ID untuk admin. Lihat [panduan menu dan notifikasi](docs/installation.md#menu-telegram-dan-notifikasi-startup).

## API

```bash
curl --fail-with-body -X POST http://localhost:3000/scan \
  -H 'content-type: application/json' \
  -d '{"mint":"So11111111111111111111111111111111111111112"}'
```

JSON mencakup `snapshot`, `cohortSize`, `classification`, `historicalScore`, `similarWinRatePct`, `similarMedianReturn24hPct`, `metrics`, dan `warnings`. `classification`, skor dan statistik historis default `null`. Pada mode mock snapshot masih merupakan fixture berlabel jelas dengan warning demo; Telegram hanya menampilkan pemberitahuan demo. HTTP 400 untuk input salah dan 502 untuk kegagalan provider. API tidak menjalankan worker runner; worker berjalan dalam proses Telegram.

API untuk EVM wajib menerima `chain`: `{"mint":"0x...","chain":"bsc"}` atau `"robinhood"`. Tidak ada penentuan jaringan dari alamat `0x` saja. Identitas histori dan cache adalah chain + CA; alamat yang sama pada dua jaringan tidak tercampur.

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
- Scan mengambil `token info` dan `token security`; cache per CA selama 10 detik.
- Worker mengambil trending per jaringan dan memperbarui kandidat tiap siklus. Alert kandidat baru/2x/5x dikirim hanya ke TELEGRAM_RUNNER_CHAT_ID; tidak ada broadcast ke semua pengguna atau alert transaksi wallet.
- Metrik yang tidak memiliki padanan semantik tetap `null`; volume bundler tidak diperlakukan sebagai kepemilikan bundler.
- Runner menyimpan maksimal 50 kandidat per jaringan. Saat `oldTokenVolume.enabled=true` (default), token tersimpan tetap dipantau tanpa batas tujuh hari; jika fitur dimatikan, masa pantau kembali tujuh hari. Harga puncak/drawdown adalah sampel yang teramati, bukan seluruh tick pasar.
- PostgreSQL belum terhubung ke proses scan; belum ada migrasi atau penyimpanan laporan ke database.
- API belum memiliki autentikasi atau rate limiting. Batasi akses server seperti pada tutorial.
- Validasi awal memakai pola base58/EVM; query provider memverifikasi data token. Pemeriksaan ini bukan audit kontrak on-chain.

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
