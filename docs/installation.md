# Tutorial Instalasi dari Awal sampai Berjalan

Panduan menggunakan terminal macOS atau Ubuntu/Debian. Windows dapat mengikuti jalur Ubuntu melalui WSL2. Jalankan perintah aplikasi dari root repository.

Target selesai: API menghasilkan JSON dengan sumber `fixture`, bot membalas `/start` dan `/scan`, serta pengujian lokal lulus. Mode live adalah tahap tambahan dengan akses GMGN.

## 1. Pasang Tools

Siapkan Git, Node.js, dan Python 3.10 atau lebih baru. Aplikasi membutuhkan Node minimal 20.12; untuk instalasi baru gunakan Node 22 atau 24 dan pastikan memenuhi persyaratan pnpm.

### macOS

```bash
xcode-select --install
```

Pasang Node menggunakan installer di [nodejs.org](https://nodejs.org/en/download), dan Python dari [python.org](https://www.python.org/downloads/). Buka ulang terminal setelah instalasi.

### Ubuntu/Debian atau WSL2

```bash
sudo apt update
sudo apt install -y git curl ca-certificates python3 python3-venv python3-pip
```

Pasang Node dengan metode Linux di [halaman download Node.js](https://nodejs.org/en/download). Paket bawaan distro dapat lebih lama; cek versinya sebelum melanjutkan.

### pnpm

```bash
npm install -g pnpm@11.25.0
git --version
node --version
pnpm --version
python3 --version
```

Jika instalasi global gagal karena izin, gunakan Node melalui version manager di direktori pengguna sesuai panduan Node. Jalankan aplikasi sebagai pengguna biasa.

## 2. Clone dan Install Dependency

```bash
git clone https://github.com/bltzkrgg/scanner-intelligence-bot.git
cd scanner-intelligence-bot
pnpm install --frozen-lockfile
```

Jika repository private, gunakan akun GitHub yang memiliki akses. Lockfile menjaga versi dependency konsisten. Workspace mengizinkan build `esbuild` untuk `tsx`.

## 3. Konfigurasi Environment

Untuk instalasi pertama:

```bash
cp .env.example .env
```

Edit `.env` dengan editor:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/solana_token_intelligence
TELEGRAM_BOT_TOKEN=
GMGN_PROVIDER=mock
GMGN_API_KEY=
LOG_LEVEL=info
```

Mode mock tidak membutuhkan akses GMGN atau PostgreSQL. Database belum digunakan oleh scanner, jadi pemasangan PostgreSQL belum diperlukan untuk menyelesaikan instalasi MVP. Jangan menimpa `.env` saat update.

Startup memakai `--env-file=.env`. Variabel yang sudah di-export oleh shell mengalahkan nilai file; periksa hal ini jika perubahan konfigurasi tidak berlaku.

## 4. Verifikasi Build dan Test

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:python
```

Semua perintah harus selesai dengan exit code nol. Tes lokal tidak memerlukan Telegram atau GMGN. `build` menghasilkan `dist`, tetapi panduan menjalankan source melalui `tsx`.

## 5. Jalankan API

Terminal pertama:

```bash
pnpm api:dev
```

Terminal kedua:

```bash
curl --fail-with-body -X POST http://localhost:3000/scan \
  -H 'content-type: application/json' \
  -d '{"mint":"So11111111111111111111111111111111111111112"}'
```

Hasil yang diharapkan: HTTP 200 dengan `snapshot.symbol: "MOCK"`, `snapshot.source: "fixture"`, skor, klasifikasi, dan metrics. Data mock tidak menggambarkan token sebenarnya.

Tekan `Ctrl+C` untuk menghentikan API. Jika port sudah dipakai, ubah `PORT` di `.env`, restart, lalu gunakan port baru pada URL curl.

## 6. Buat Bot Telegram

1. Buka akun resmi [@BotFather](https://t.me/BotFather) di Telegram.
2. Kirim `/newbot`.
3. Ikuti arahan untuk nama dan username bot.
4. Masukkan token yang diberikan ke `TELEGRAM_BOT_TOKEN` dalam `.env` lokal. Jangan kirim token ke chat atau repository.
5. Opsional: gunakan `/setcommands`, pilih bot, lalu masukkan:

```text
start - Mulai menggunakan bot
scan - Analisis alamat mint Solana
```

## 7. Jalankan Bot dan Uji Laporan

```bash
pnpm telegram:dev
```

Buka chat bot, tekan Start atau kirim `/start`, kemudian:

```text
/scan So11111111111111111111111111111111111111112
```

Bot harus mengirim laporan Indonesia dengan klasifikasi, skor, sumber `fixture`, metrics, dan risiko. Bot memakai Telegram long polling untuk menerima pesan; tidak ada polling harga token. Jalankan satu proses per token bot.

API tidak perlu aktif karena bot memanggil scanner langsung. Terminal harus tetap terbuka sampai service dipasang. Tekan `Ctrl+C` untuk berhenti. Pengujian Telegram sungguhan membutuhkan token dan internet; test lokal tidak memverifikasi autentikasi Telegram Anda.

## 8. GMGN Live (Opsional)

Adapter masih awal: field belum terpetakan diisi nol dan mapping JSON belum diuji live dalam proyek.

```bash
npm install -g gmgn-cli
gmgn-cli --version
```

Ajukan API key query di [GMGN](https://gmgn.ai/ai) mengikuti [panduan resmi](https://github.com/GMGNAI/gmgn-skills#3-get-your-own-api-key). Isi `GMGN_API_KEY` di `.env`, ubah `GMGN_PROVIDER=cli`, lalu restart aplikasi. Adapter hanya memakai API key untuk query read-only.

Periksa dari root repo:

```bash
gmgn-cli token info --chain sol --address So11111111111111111111111111111111111111112 --raw
```

Selesaikan akses atau autentikasi CLI sebelum scan live. Lihat [catatan integrasi](gmgn-integration.md).

## 9. Dataset Riset (Opsional)

Script memiliki fallback CSV tanpa dependency tambahan. Untuk stack riset lengkap:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r research/requirements.txt
pnpm research:build-dataset
pnpm research:label-outcomes
```

Output: `research/data/benchmark.csv` dan `research/data/benchmark_labeled.csv`. Input awal adalah fixture sintetis. CSV belum otomatis dipakai scanner; scanner membaca `research/data/benchmark.fixture.json`.

Untuk ekspor sendiri, sediakan array JSON dengan field `TokenSnapshot` ditambah `outcomeReturn24hPct` dan `outcomeMaxDrawdown24hPct`:

```bash
python3 research/scripts/build_dataset.py --input /path/to/export.json --output research/data/benchmark.csv
python3 research/scripts/label_outcomes.py
deactivate
```

## 10. Jalankan Terus di Server Ubuntu

Selesaikan langkah 1-7 di server sebagai pengguna biasa. Contoh systemd mengasumsikan user `scanner` dan folder `/home/scanner/scanner-intelligence-bot`; sesuaikan dengan mesin Anda.

Cari executable:

```bash
command -v node
command -v pnpm
```

Buat `/etc/systemd/system/scanner-telegram.service` menggunakan `sudoedit`. Sesuaikan path pnpm dan direktori Node dengan hasil tadi:

```ini
[Unit]
Description=Solana Intelligence Telegram Bot
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=scanner
WorkingDirectory=/home/scanner/scanner-intelligence-bot
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/pnpm telegram:dev
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Jika memakai version manager, gunakan path absolut pnpm pada `ExecStart` dan tambahkan direktori Node/pnpm ke `PATH`. Tambahkan direktori CLI jika memakai GMGN. systemd tidak memuat konfigurasi shell interaktif.

```bash
chmod 600 .env
sudo systemctl daemon-reload
sudo systemctl enable --now scanner-telegram
sudo systemctl status scanner-telegram
sudo journalctl -u scanner-telegram -n 50 --no-pager
```

Status yang diharapkan `active (running)`. Ulangi `/start` dan `/scan` di Telegram. Hentikan proses terminal dengan token sama sebelum service diaktifkan.

API opsional. Jika dijalankan di VPS, batasi port melalui firewall karena API listen pada `0.0.0.0` dan belum memiliki autentikasi. Akses dari komputer melalui SSH tunnel dengan port API tidak dibuka ke publik:

```bash
ssh -L 3000:127.0.0.1:3000 scanner@ALAMAT_SERVER
```

Panggil `http://localhost:3000/scan` dari komputer saat API aktif di server.

## 11. Update

```bash
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:python
sudo systemctl restart scanner-telegram
```

Tambahkan variabel baru dari `.env.example` ke `.env` secara manual. Uji scan lagi setelah restart.

## Troubleshooting

| Gejala | Penyelesaian |
| --- | --- |
| `.env` tidak ditemukan | Buat file sesuai langkah 3; jalankan dari root repo |
| Token Telegram wajib diisi | Isi `.env`, restart, cek environment shell yang menimpa nilai |
| Telegram 401 | Perbaiki token atau buat ulang melalui BotFather |
| Telegram 409 | Hentikan instance lain; hapus webhook lama jika pernah dikonfigurasi |
| `EADDRINUSE` | Ubah `PORT` atau hentikan proses Anda yang memakai port itu |
| CLI tidak ditemukan | Instal dan pastikan PATH proses/service benar |
| GMGN 401/403/timeout | Periksa kredensial, akses query, jaringan, dan petunjuk resmi |
| Semua mint menjadi MOCK | Normal pada mode `mock` |
| PostgreSQL tidak berisi laporan | Persistence belum terhubung pada MVP |
| Build gagal pada Node lama | Gunakan versi kompatibel dan install dependency ulang |

Instalasi dasar selesai ketika API mengembalikan fixture dan bot membalas laporan. Data pasar live dan benchmark riil masih perlu divalidasi.
