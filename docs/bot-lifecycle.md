# Notifikasi Online, Offline, dan Heartbeat

## Apa yang Tersedia

| Kejadian | Pengirim | Perilaku |
| --- | --- | --- |
| Bot mulai menerima update | Proses bot | ONLINE, sekali per startup |
| SIGINT/SIGTERM, termasuk PM2 stop/restart | Proses bot | Hentikan worker, tunggu pekerjaan berjalan, checkpoint state, lalu kirim OFFLINE |
| Startup/polling runtime gagal | Proses bot jika masih mampu mengirim | OFFLINE dengan alasan generik, exit code 1 |
| SIGKILL, proses hang, endpoint/server/jaringan bermasalah | Monitor terpisah | TIDAK TERHUBUNG setelah heartbeat sehat hilang sesuai timeout |
| Heartbeat pulih setelah alert gangguan | Monitor terpisah | HEARTBEAT PULIH sekali; bukan bukti GMGN sehat |

`/runner_off` hanya menjeda runner, bukan menghentikan seluruh bot, sehingga tidak mengirim OFFLINE. Notifikasi lifecycle memakai `TELEGRAM_STARTUP_CHAT_ID` yang sudah ada, bukan `TELEGRAM_RUNNER_CHAT_ID`. Tanpa chat tujuan, ONLINE/OFFLINE tidak dikirim. Ini bukan broadcast ke semua user.

Notifikasi bot saat stop bersifat best effort. SIGKILL, listrik mati, internet putus atau Telegram tidak dapat diakses bisa mencegah pengiriman. Monitor pada mesin yang sama hanya membantu saat proses bot gagal; untuk mendeteksi server mati, jalankan monitor di mesin lain dengan koneksi dan process supervisor tersendiri. Monitor tidak dijalankan otomatis oleh proses bot, dan tidak memerlukan bot utama tetap hidup.

## 1. Aktifkan Online dan Offline

Di `.env` bot, isi ID dari `/chatid`:

```dotenv
TELEGRAM_STARTUP_CHAT_ID=123456789
BOT_SHUTDOWN_TIMEOUT_SEC=25
```

Chat pribadi harus sudah memulai bot; grup/channel harus mengizinkan bot mengirim. Kosongkan chat ID untuk menonaktifkan kedua pesan lifecycle. Perubahan `.env` membutuhkan restart.

Shutdown menunggu promise polling (termasuk middleware aktif) dan siklus runner yang sedang berjalan sebelum checkpoint. Hanya checkpoint yang berhasil mendapat baris "snapshot state terakhir berhasil disimpan". Ini tidak memulihkan observasi yang pernah gagal ditulis sebelumnya. Jika checkpoint gagal, pesan menyatakan GAGAL. Sinyal berulang tidak mengirim OFFLINE berulang.

Pengiriman ONLINE/OFFLINE memiliki batas 5 detik per pesan. Shutdown keseluruhan dibatasi 25 detik secara default (valid 10-120). Jika pekerjaan macet melewati batas, proses dipaksa keluar dengan code 1, tanpa mengklaim penyimpanan/pengiriman berhasil. Monitor terpisah diperlukan sebagai cadangan. Kegagalan sangat awal, sebelum runtime/handler lifecycle terpasang (misalnya config atau state rusak), juga perlu dideteksi monitor.

## 2. PM2

Dari root repository, sesudah tools, dependency dan `.env` siap:

```bash
pm2 start "$(command -v node)" --name scanner-telegram --interpreter none --kill-timeout 30000 -- --env-file=.env --import tsx apps/telegram/src/bot.ts
pm2 save
```

Jalankan hanya satu proses bot dan jangan gunakan cluster. Untuk proses yang sudah dikonfigurasi dengan kill timeout 30 detik, cukup `pm2 restart scanner-telegram --update-env` setelah upgrade. Jika definisi lama belum memakai kill timeout yang cukup, hentikan/hapus definisi PM2 lamanya lalu buat kembali dengan command di atas; jangan jalankan dua proses bot bersamaan. Ini tidak menghapus `.env` atau file state.

`kill-timeout` PM2 harus lebih besar dari `BOT_SHUTDOWN_TIMEOUT_SEC` agar proses sempat menyelesaikan checkpoint/notifikasi. Default PM2 dapat memaksa SIGKILL terlalu cepat. Jika shutdown bot diubah menjadi 60 detik, gunakan kill timeout PM2 minimal 65.000 ms. Untuk systemd sesuaikan juga `TimeoutStopSec`. Lihat [dokumentasi graceful shutdown PM2](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/).

Uji penghentian normal pada waktu aman:

```bash
pm2 stop scanner-telegram
pm2 start scanner-telegram
```

Urutan normal: OFFLINE lalu ONLINE. Telegram/koneksi dapat tetap menggagalkan salah satu pesan; periksa log jika tidak diterima.

## 3. Health Endpoint pada Bot

Buat secret acak, jangan gunakan token bot sebagai secret health:

```bash
openssl rand -hex 32
```

Tambahkan hasilnya ke `.env` bot:

```dotenv
BOT_HEALTH_ENABLED=true
BOT_HEALTH_HOST=127.0.0.1
BOT_HEALTH_PORT=3101
BOT_HEALTH_TOKEN=isi_secret_acak_minimal_32_karakter
```

Restart bot. Endpoint `GET /health` memerlukan `Authorization: Bearer <BOT_HEALTH_TOKEN>`. Tidak ada token pada URL, response tidak memuat kredensial, dan cache dinonaktifkan. Endpoint dapat menjawab HTTP 200 meskipun polling macet: monitor menilai `phase` dan timestamp heartbeat pada body, bukan hanya status HTTP.

Heartbeat diperbarui saat `getUpdates` Telegram berhasil. Startup memiliki grace period dari waktu ready sampai polling pertama berhasil. `starting`/`stopping`, payload tidak valid, polling terakhir kedaluwarsa, HTTP error dan autentikasi salah semuanya dianggap tidak sehat. Server HTTP yang masih hidup tidak otomatis membuat bot dianggap sehat. Polling/middleware yang lama terhambat juga bisa menghasilkan alarm "tidak terhubung", bukan kepastian proses mati.

Untuk monitor di mesin lain, gunakan VPN/private network atau reverse proxy HTTPS yang tidak meng-cache `/health`. Arahkan ke host bot yang sebenarnya, bukan localhost mesin monitor. Jangan membuka endpoint ber-token melalui HTTP plaintext di internet; batasi firewall ke mesin monitor dan jangan menaruh token pada access log. Binding default loopback tidak dapat diakses langsung dari mesin lain. Sinkronkan waktu kedua mesin; skew lebih dari 30 detik ke masa depan ditolak.

## 4. Jalankan Monitor Independen

Di mesin monitor, pasang repository dan dependency, kemudian:

```bash
cp .env.monitor.example .env.monitor
```

Isi `.env.monitor` (jangan commit file ini):

```dotenv
TELEGRAM_BOT_TOKEN=token_bot_pengirim_monitor
TELEGRAM_MONITOR_CHAT_ID=123456789
BOT_HEALTH_URL=http://127.0.0.1:3101/health
BOT_HEALTH_TOKEN=secret_yang_sama_dengan_bot
BOT_MONITOR_POLL_INTERVAL_SEC=15
BOT_MONITOR_TIMEOUT_SEC=120
BOT_MONITOR_STATE_FILE=data/bot-monitor.json
```

URL localhost di atas hanya untuk monitor pada mesin yang sama. Untuk monitor remote, ganti dengan URL HTTPS/private bot Anda. Token pengirim monitor boleh sama dengan bot utama karena monitor **tidak** memanggil getUpdates; lebih baik bot pengirim terpisah jika ingin tetap bisa memberi tahu ketika token bot utama dicabut. Bot pengirim monitor juga harus memiliki akses ke chat tujuan. Jika `TELEGRAM_MONITOR_CHAT_ID` kosong, monitor mencoba `TELEGRAM_STARTUP_CHAT_ID`; salah satunya wajib valid.

Jalankan untuk pengujian:

```bash
pnpm telegram:monitor
```

Untuk PM2, hentikan proses uji foreground terlebih dahulu, lalu:

```bash
pm2 start "$(command -v node)" --name scanner-monitor --interpreter none --kill-timeout 15000 -- --env-file=.env.monitor --import tsx apps/telegram/src/monitor.ts
pm2 logs scanner-monitor --lines 50
pm2 save
pm2 startup
```

Jalankan perintah sudo yang dicetak `pm2 startup`, lalu `pm2 save` lagi untuk boot persistence. Jangan jalankan lebih dari satu monitor untuk file state yang sama. Monitor dan bot memakai file state yang berbeda; cadangkan keduanya saat proses dihentikan.

Interval monitor valid 5-300 detik, timeout valid 60-3600 detik dan harus lebih besar dari interval. Probe HTTP dibatasi 5 detik, redirect ditolak agar header secret tidak diteruskan ke host lain. Timeout dihitung dari heartbeat sehat terakhir; jika monitor belum pernah menerima heartbeat, hitungan dimulai pada probe gagal pertama. Waktu alarm bisa terlambat satu interval/probe, bukan jadwal real-time yang dijamin.

State menyimpan status gangguan dan pesan tertunda. Gangguan berkelanjutan mengirim satu alert, bukan setiap polling; restart monitor tidak mengulang alert yang sudah diakui. Pesan gagal dikirim dicoba kembali. Alert DOWN tertunda dibatalkan bila layanan sudah pulih sebelum pesan terkirim. Pengiriman bukan exactly-once: crash setelah Telegram menerima pesan tetapi sebelum acknowledgment tersimpan bisa menghasilkan duplikat.

Saat maintenance panjang, monitor akan tetap mengirim alarm jika heartbeat hilang, meskipun bot sebelumnya sempat mengirim OFFLINE. Hentikan monitor sementara bila memang ingin menekan alarm maintenance, lalu jalankan kembali setelah bot siap. Restart bot yang pulih sebelum timeout tidak selalu menghasilkan alert gangguan; ONLINE/OFFLINE lifecycle tetap terpisah.

## 5. Contoh Pesan

```text
TOKEN INTELLIGENCE | ONLINE

Bot mulai berjalan dan siap menerima CA.
Jaringan: Solana | BSC | Robinhood Chain (RH)
Mode data: GMGN Live
Runner: Aktif
Alert jaringan:
Solana: Aktif | polling 60 detik
BSC: Aktif | polling 60 detik
Robinhood Chain (RH): Aktif | polling 60 detik
Tujuan alert runner: dikonfigurasi

Waktu mulai: 18 Oct 2026, 17:45:00 WIB
Status proses aktif. Koneksi GMGN belum diverifikasi sebelum query berhasil.
```

OFFLINE memuat alasan SIGINT/SIGTERM, uptime, waktu WIB dan hasil checkpoint. TIDAK TERHUBUNG menyatakan kemungkinan proses/server/endpoint/polling terganggu, heartbeat terakhir dan waktu deteksi. HEARTBEAT PULIH hanya mengonfirmasi koneksi polling menurut monitor, bukan kesehatan GMGN atau pengiriman alert runner.

## Batas Verifikasi

Tes lokal menggunakan Telegram API mock dan skenario shutdown/monitor deterministik. Health endpoint juga diuji melalui HTTP loopback untuk autentikasi dan heartbeat kedaluwarsa. Telegram asli, PM2 pada server Anda, koneksi lintas mesin, firewall/TLS dan reboot server tetap memerlukan uji deployment. Jika bot dan monitor sama-sama tidak dapat menghubungi Telegram, tidak ada jaminan notifikasi sampai koneksi pengirim pulih.
