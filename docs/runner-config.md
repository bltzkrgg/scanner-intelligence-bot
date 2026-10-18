# Pengaturan dan Notifikasi Runner Telegram

## Aktivasi

Pasang bot dengan [tutorial instalasi](installation.md), kemudian gunakan provider live sesuai [panduan multichain](multichain-and-alerts.md). Isi `.env`:

```dotenv
GMGN_PROVIDER=cli
GMGN_API_KEY=isi_api_key_anda
RUNNER_ENABLED=true
ENABLED_CHAINS=sol,bsc,robinhood
TELEGRAM_ADMIN_IDS=123456789
TELEGRAM_RUNNER_CHAT_ID=-1001234567890
RUNNER_STATE_FILE=data/runners.json
```

Admin IDs adalah user ID, bukan chat ID; ambil melalui `/chatid`. Untuk private chat, user harus memulai bot; untuk grup/channel, bot harus punya izin mengirim. Startup notification tetap terpisah melalui `TELEGRAM_STARTUP_CHAT_ID`. Jalankan hanya satu proses Telegram untuk satu token bot dan file state; jangan memakai PM2 cluster.

Perubahan `.env` perlu restart. Jika belum ada proses PM2, setelah dependency terpasang dan `.env` terisi, jalankan dari root repository dengan Node 24:

```bash
npm install -g pm2
pm2 start "$(command -v node)" --name scanner-telegram --interpreter none --kill-timeout 30000 -- --env-file=.env --import tsx apps/telegram/src/bot.ts
pm2 logs scanner-telegram --lines 50
pm2 save
pm2 startup
```

Jalankan perintah sudo yang dicetak `pm2 startup` untuk mengaktifkan service saat reboot, lalu `pm2 save` lagi. Jangan menjalankan proses PM2 kedua atau `pnpm telegram:dev` bersamaan dengan proses ini. Jika sebelumnya memakai systemd untuk bot yang sama, hentikan service itu sebelum beralih ke PM2.

Setelah upgrade kode pada instalasi yang sudah berjalan:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm test
pm2 restart scanner-telegram --update-env
```

Cadangkan file state sebelum upgrade. Versi state sekarang 3; versi 1/2 dibaca otomatis, config yang belum ada memakai default di bawah. Kandidat historis tidak dikirim ulang. Bot versi lama tidak mendukung state versi 3; gunakan backup untuk rollback. Jangan menghapus file state hanya untuk memperbaiki config.

Di Telegram, admin menjalankan:

```text
/runner_test
/runner_on
/getconfig
/setconfig tokenAlerts.enabled true
/setconfig robinhoodAlerts.enabled true
```

`enabled=true` tidak menggantikan prasyarat `.env`, tidak menambahkan chain di luar `ENABLED_CHAINS`, dan tidak membatalkan `/runner_off`. Semua pengaturan di sini berlaku bersama untuk bot, bukan per-user/per-chat. Hanya `TELEGRAM_ADMIN_IDS` yang boleh membaca/mengubah config.

## Mekanisme Pengiriman

1. Worker mengecek jadwal per jaringan, mengambil maksimal 10 token trending GMGN interval 5m serta kandidat tersimpan yang belum melewati masa pantau 7 hari.
2. Token info/security diperiksa. Data wajib yang tidak tersedia menggagalkan filter; tidak diganti nol. Indikasi honeypot/wash trading dan blok keamanan provider yang sudah diterapkan tetap berlaku.
3. Solana/RH memakai filter admin di bawah untuk kandidat baru. BSC tetap memakai rule Runner Score lama; belum ada `/setconfig` BSC.
4. Kandidat baru dicatat sekali dengan harga saat deteksi, lalu event dimasukkan ke antrean persisten. CA yang dikirim langsung atau `/runner` juga bisa masuk histori ketika pemantauan dan alert chain aktif.
5. Setelah siklus jaringan selesai, bot mengirim antreannya ke `TELEGRAM_RUNNER_CHAT_ID`, bukan membroadcast ke seluruh user.
6. Jika harga sampel mencapai 2x/5x dari harga pertama deteksi, masing-masing milestone dicatat sekali. Solana juga punya event spike terpisah dengan baseline dan cooldown.

`maxPerScan` membatasi jumlah pesan/event yang dikirim per jaringan per siklus, termasuk candidate, spike dan milestone. Bukan batas seluruh token yang di-query. Sisa event tetap antre. BSC memakai batas 5; pengiriman gabungan dibatasi 50 event per flush dengan jeda minimal 1,1 detik antar pesan. Antrean maksimal 1.000 event; jika penuh observasi yang memerlukan event baru tidak disimpan, error terlihat pada status siklus. Pulihkan pengiriman, jangan menghapus state sembarangan.

Kegagalan pengiriman mempertahankan antrean untuk jadwal berikutnya. Jika Telegram sudah menerima tetapi proses berhenti sebelum acknowledgment tersimpan, pesan bisa terkirim ulang; Event ID membantu mengenali duplikat. Data event lebih dari 15 menit dilabeli notifikasi tertunda. Menonaktifkan alert chain menahan polling/observasi/pengiriman untuk chain itu, bukan menghapus histori dan antreannya; scan biasa tetap tersedia.

Interval adalah jarak minimum antar awal polling jaringan, bukan jaminan ketepatan waktu. Siklus tidak tumpang tindih; latensi CLI, serialisasi request, antrean, dan cooldown provider dapat memperpanjangnya. Global `RUNNER_INTERVAL_SECONDS` kini dipakai untuk BSC; Solana/RH mengikuti `/getconfig`. Perubahan config berlaku pada pengecekan berikutnya tanpa restart; request/pesan yang sudah sedang dikirim tidak bisa dibatalkan.

## Solana Runner

| Key | Default | Validasi / arti |
| --- | --- | --- |
| `tokenAlerts.enabled` | `true` | Boolean `true` / `false` |
| `tokenAlerts.pollIntervalSec` | `60` | Bilangan bulat 15-300 detik |
| `tokenAlerts.minVolume5mUsd` | `100000` | Volume rolling 5m >= nilai ini, USD; >= 0 |
| `tokenAlerts.minMarketCapUsd` | `100000` | Market cap **lebih besar** dari nilai ini, USD; >= 0 |
| `tokenAlerts.minTotalFeesSol` | `10` | Total fees GMGN >= nilai ini, SOL; >= 0 |
| `tokenAlerts.maxAgeMin` | `30` | Umur DEX open/migration <= nilai ini; bilangan bulat 1-43200 menit |
| `tokenAlerts.maxPerScan` | `5` | Bilangan bulat 1-50 |
| `tokenAlerts.volumeSpikeMultiplier` | `3` | Rasio volume 5m terhadap baseline >= nilai ini; > 1, <= 1000 |
| `tokenAlerts.volumeSpikeMinSwaps5m` | `50` | Minimal swaps rolling 5m; bilangan bulat >= 0 |
| `tokenAlerts.volumeSpikeMinLiquidityUsd` | `10000` | Likuiditas minimal USD; >= 0 |
| `tokenAlerts.volumeSpikeCooldownMin` | `360` | Jeda spike per CA; bilangan bulat 1-43200 menit |

```text
/setconfig tokenAlerts.enabled true
/setconfig tokenAlerts.pollIntervalSec 60
/setconfig tokenAlerts.minVolume5mUsd 100000
/setconfig tokenAlerts.minMarketCapUsd 100000
/setconfig tokenAlerts.minTotalFeesSol 10
/setconfig tokenAlerts.maxAgeMin 30
/setconfig tokenAlerts.maxPerScan 5
/setconfig tokenAlerts.volumeSpikeMultiplier 3
/setconfig tokenAlerts.volumeSpikeMinSwaps5m 50
/setconfig tokenAlerts.volumeSpikeMinLiquidityUsd 10000
/setconfig tokenAlerts.volumeSpikeCooldownMin 360
```

New-token alert memerlukan harga live, volume, market cap, fees dan umur DEX sesuai threshold. Bukan syarat Runner Score >= 70. Runner Score tetap ditampilkan sebagai rule eksperimen terpisah, bukan probabilitas profit atau audit risiko lengkap. Periksa konsentrasi holder dan metrik risiko lain sendiri; filter momentum ini tidak menjadikan token aman.

Spike memakai harga live, min volume/market cap/fees yang sama, ditambah multiplier, swaps dan likuiditas. Batas umur **tidak** diterapkan pada spike, agar token lama yang kembali aktif dapat terdeteksi.

Baseline adalah rata-rata 3 sampel rolling 5m terdahulu, dengan waktu akhir antar sampel minimal 5 menit. Sampel terakhir harus minimal 5 menit sebelum query sekarang dan seluruh sampel baseline maksimal berumur 30 menit. Butuh sedikitnya sekitar 15 menit observasi; polling 60 detik tidak berarti enam window 5m yang independen. Baseline nol/tidak lengkap tidak menghasilkan spike. Histori baseline dan cooldown disimpan saat restart; setelah jeda panjang baseline harus terkumpul lagi. Hanya token yang benar-benar pernah di-query punya baseline (maksimal 500 CA paling baru), bukan seluruh pasar.

Jika deteksi pertama sekaligus memenuhi filter kandidat dan spike, hanya satu alert kandidat dikirim dan cooldown spike dimulai. Spike berikutnya baru boleh muncul setelah cooldown dan syarat lonjakan terpenuhi lagi. Histori kandidat maksimal 50 per jaringan; jika penuh kandidat baru tidak disimpan. `/runner_remove sol <CA>` menghapus histori, antrean dan baseline CA itu, bukan blacklist.

## Robinhood Runner

| Key | Default | Validasi / arti |
| --- | --- | --- |
| `robinhoodAlerts.enabled` | `true` | Boolean `true` / `false` |
| `robinhoodAlerts.pollIntervalSec` | `60` | Bilangan bulat 15-300 detik |
| `robinhoodAlerts.minVolume5mUsd` | `100000` | Minimal volume rolling 5m USD; >= 0 |
| `robinhoodAlerts.minTotalFeesEth` | `0.1` | Minimal total fees GMGN ETH; >= 0 |
| `robinhoodAlerts.maxPerScan` | `5` | Bilangan bulat 1-50 |

```text
/setconfig robinhoodAlerts.enabled true
/setconfig robinhoodAlerts.pollIntervalSec 60
/setconfig robinhoodAlerts.minVolume5mUsd 100000
/setconfig robinhoodAlerts.minTotalFeesEth 0.1
/setconfig robinhoodAlerts.maxPerScan 5
```

RH tidak memiliki filter umur/market cap atau config spike dalam versi ini. Respons security tetap diperlukan, indikator honeypot/wash trading positif tetap memblokir. Jika field honeypot RH tidak disediakan provider, keterbatasan itu ditampilkan, bukan diklaim aman.

## Sumber dan Definisi Data

Volume/swaps berasal dari `token info.price.volume_5m` / `swaps_5m`. Fees memakai `token info.total_fee` native chain (SOL untuk Solana, ETH untuk RH), **bukan** `market trending.gas_fee` (rata-rata gas per transaksi), bukan USD, dan bukan fees rolling 5 menit. Nilai mentah total GMGN ditampilkan tanpa mengarang jendela akumulasinya. Jika field hilang, filter fees tidak lolos.

Umur DEX memakai timestamp terbaru dari `migrated_timestamp` / `open_timestamp` yang disediakan provider, bukan `creation_timestamp`. Timestamp nol/hilang/di masa depan menghasilkan umur tidak tersedia dan menahan alert token baru Solana. Market cap dihitung harga dikali circulating supply. Ketersediaan seluruh field bergantung chain, token, dan akses provider.

Referensi: [GMGN market skill resmi](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-market/SKILL.md), [GMGN token skill resmi](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md). Field biaya dan timestamp tambahan juga diperiksa pada respons CLI live; jangan mengganti metrik dengan field yang hanya mirip namanya.

## Contoh Pesan

Data di bawah ilustrasi, bukan hasil deteksi pasar. Pesan aktual juga memuat waktu data UTC, Event ID, link command detail, serta warning provider jika ada.

```text
KANDIDAT TOKEN RUNNER BARU

Solana | EXAMPLE
CA: <CA>

Harga: $0.00042
Market cap: $420,000
Likuiditas: $65,000
Volume 5m: $185,000
Swaps 5m: 120
Total fees GMGN: 12.5 SOL
Umur DEX/migration: 18 menit

Lolos: filter alert admin. Bukan skor profit.

Data: GMGN CLI | <waktu UTC>
Detail: /runner sol <CA>
Event ID: <identitas-event>

Harga berdasarkan sampel saat query. Filter momentum bukan pemeriksaan
risiko lengkap. Kandidat bukan jaminan kenaikan atau sinyal beli.
```

```text
VOLUME SPIKE TERDETEKSI

Solana | EXAMPLE
CA: <CA>

Harga: $0.0005
Market cap: $500,000
Likuiditas: $65,000
Volume 5m: $240,000
Swaps 5m: 150
Total fees GMGN: 14 SOL
Umur DEX/migration: 90 menit

Lonjakan: 4x
Baseline 5m: $60,000 (rata-rata 3 jendela sebelumnya)

Data: GMGN CLI | <waktu UTC>
Detail: /runner sol <CA>
Event ID: <identitas-event>

Harga berdasarkan sampel saat query. Filter momentum bukan pemeriksaan
risiko lengkap. Kandidat bukan jaminan kenaikan atau sinyal beli.
```

RH memakai struktur kandidat yang sama, label `Robinhood Chain (RH)` dan fees `ETH`. Jika umur tidak disediakan, tertulis `belum tersedia`. Milestone memakai judul `TOKEN RUNNER: 2X TERAMATI` / `5X TERAMATI`, beserta kelipatan aktual sampel, perubahan persen dan harga awal; bukan janji target berikutnya.

## Penyimpanan dan Troubleshooting

Gunakan `/getconfig`, `/getconfig tokenAlerts` atau `/getconfig robinhoodAlerts`. Nama camelCase seperti `tokenAlertsEnabled` dan `robinhoodAlertsMinTotalFeesEth` juga diterima sebagai alias; output selalu memakai nama dotted yang terdokumentasi. Key tak dikenal, boolean selain true/false, angka nonfinite, dan angka di luar batas ditolak tanpa mengganti config lama. File config berada bersama histori pada `RUNNER_STATE_FILE`, ditulis atomik; simpan direktori itu di storage persisten.

Jika `/runner_test` berhasil tetapi belum ada kandidat, periksa `/runners`, `/status`, `/getconfig`, umur migrasi, volume5m dan fees. Threshold ketat memang dapat menghasilkan nol kandidat. `null` bukan nol dan bukan bukti aman. Jangan menurunkan threshold hanya untuk memaksa alert muncul. Endpoint/API historis dan bank smart wallet pribadi belum ikut menilai filter ini.
