# Discord Bot

Discord memakai scanner, provider GMGN/enrichment, chain Solana/BSC/RH, serta rule runner yang sama dengan Telegram. Ini integrasi aplikasi bot di server Discord, bukan login OAuth akun pengguna. Telegram tetap berjalan lewat proses yang sudah ada.

## 1. Tools dan Repository

Gunakan Node.js 24 dan pnpm 11.25.0 sesuai [instalasi tools](installation.md#1-pasang-tools). Node untuk PM2 harus sama dengan Node yang dipakai menguji bot.

```bash
# Instalasi baru
git clone https://github.com/bltzkrgg/scanner-intelligence-bot.git
cd scanner-intelligence-bot
pnpm install --frozen-lockfile
cp .env.example .env
```

Jika repository sudah ada, jangan menimpa `.env`:

```bash
cd ~/scanner-intelligence-bot
git pull --ff-only
pnpm install --frozen-lockfile
```

## 2. Buat Aplikasi Discord

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), buat aplikasi lewat **New Application**.
2. Buka **Bot**, buat/reset token lalu simpan sebagai `DISCORD_BOT_TOKEN`. Ini token bot, bukan Application ID, Public Key, atau token akun pribadi. Jangan membagikannya atau commit `.env`.
3. Di halaman **Bot**, aktifkan **Message Content Intent** pada Privileged Gateway Intents. Ini diperlukan untuk membaca CA pada pesan biasa. Aplikasi yang memerlukan persetujuan privileged intent harus memperoleh persetujuan Discord; slash command tidak menghilangkan kewajiban intent selama proses ini masih meminta pembacaan pesan biasa.
4. Buka **OAuth2 > URL Generator**, pilih scope **bot** dan **applications.commands**. Berikan **View Channels**, **Send Messages**, **Embed Links**, dan **Read Message History**. Tidak perlu Administrator. Jika memakai thread, izin thread yang sesuai juga dibutuhkan.
5. Buka invite URL yang dihasilkan dan pilih server tujuan. Pastikan overwrite izin channel tidak melarang bot membaca/mengirim/embed.
6. Di aplikasi Discord, aktifkan **User Settings > Advanced > Developer Mode**. Klik kanan server, channel, dan akun admin untuk **Copy ID**.

Referensi resmi: [Gateway intents](https://docs.discord.com/developers/events/gateway), [interactions](https://docs.discord.com/developers/interactions/receiving-and-responding), [discord.js](https://discord.js.org/docs/packages/discord.js/14.27.0).

## 3. Isi Environment

Tambahkan bagian ini pada `.env` yang sama. Ganti contoh ID dengan ID Discord asli; jangan memakai ID Telegram:

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=111111111111111111
DISCORD_CHANNEL_IDS=222222222222222222
DISCORD_ADMIN_IDS=333333333333333333
DISCORD_STARTUP_CHANNEL_ID=222222222222222222
DISCORD_RUNNER_CHANNEL_ID=222222222222222222
DISCORD_RUNNER_STATE_FILE=data/discord-runners.json

GMGN_PROVIDER=cli
GMGN_API_KEY=
ENABLED_CHAINS=sol,bsc,robinhood
RUNNER_ENABLED=true
```

Isi key GMGN milik Anda dan pastikan `gmgn-cli` sudah tersedia di PATH proses. Key enrichment opsional tetap memakai variabel provider yang sama; [cakupan dan batasan](providers.md). Discord tidak memperbaiki kredit Tracker atau penolakan akses MadeOnSol.

`DISCORD_GUILD_ID` wajib, satu server per proses. `DISCORD_CHANNEL_IDS` dapat berisi beberapa ID dipisahkan koma; kosong berarti scan di semua channel server tersebut. DMs, pesan bot dan webhook diabaikan. Target notifikasi harus berada pada guild yang sama; konfigurasi target tidak membuka akses command di channel lain.

`DISCORD_ADMIN_IDS` adalah daftar user ID dipisahkan koma. Role Administrator/Manage Server tidak otomatis memberi akses perubahan filter: hanya user yang terdaftar. Token bot dan ID server wajib bahkan untuk mock. `RUNNER_ENABLED=false` dapat dipakai untuk scan saja. Runner aktif memerlukan mode `cli`, admin Discord, dan target runner; target startup opsional.

## 4. Build dan Coba

```bash
pnpm build
pnpm discord:dev
```

Bot mendaftarkan slash command pada server yang dikonfigurasi setelah Gateway siap. Di channel yang diizinkan:

- Kirim CA Solana langsung, atau `sol <CA>` / `bsc <CA>` / `rh <CA>`.
- Alamat `0x` tanpa chain menampilkan tombol BSC/RH; tidak menebak jaringan.
- `/scan ca:<CA> chain:<chain>` melakukan scan dengan embed MARKET/ACTIVITY/INTELLIGENCE/STATUS.
- Tombol Refresh, Detail Risiko, Status Runner dan tautan GMGN tersedia pada laporan live. CA di dalam monospace dapat disalin lewat client Discord; tidak mengklaim memiliki tombol clipboard Telegram.
- `/runner ca:<CA> chain:<chain>` membaca histori lokal; `/runners page:1` menampilkan daftar per 10 token.
- `/status` menampilkan status proses, runner, target notifikasi dan antrean.
- Admin: `/getconfig section:tokenAlerts`, `/setconfig key:tokenAlerts.minVolume5mUsd value:100000`.
- Admin: `/runner_on`, `/runner_off`, `/runner_remove ca:<CA> chain:<chain>`.

Nama `chain:`, `key:` dan lainnya adalah opsi native slash command Discord, bukan teks yang ditempel sebagai satu argumen. Semua key/filter termasuk minimum fees tiap chain mengikuti [pengaturan runner](runner-config.md). Pengaturan melalui Discord hanya mengubah state runner Discord, bukan Telegram. Penghapusan token tidak melarang rediscovery token tersebut pada polling berikutnya.

Scan dibatasi satu request berjalan per user, cooldown 10 detik, dan maksimum 3 scan user bersamaan per proses; worker provider tetap mempunyai limiter sendiri. Respons interaction ditunda sebelum query agar tidak kedaluwarsa saat GMGN lambat. Pesan/error provider tidak boleh memicu mention massal.

## 5. Jalankan Dengan PM2

```bash
npm install -g pm2
pm2 start ecosystem.discord.config.cjs --only scanner-discord
pm2 logs scanner-discord --lines 50
pm2 save
```

Untuk menyala setelah reboot, jalankan `pm2 startup`, ikuti perintah systemd yang dicetak PM2, lalu `pm2 save`. Telegram dapat tetap berjalan lewat `ecosystem.config.cjs`; jangan menghentikannya untuk menyalakan Discord.

Setelah update atau mengubah `.env`:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pm2 restart ecosystem.discord.config.cjs --only scanner-discord --update-env
pm2 save
```

## State, Alert dan Batasan

Discord memakai `DISCORD_RUNNER_STATE_FILE` sendiri, default `data/discord-runners.json`. Jangan menunjuk ke `RUNNER_STATE_FILE` Telegram; entry point menolak path yang sama. Jangan menjalankan lebih dari satu writer untuk file tersebut. Histori, baseline, pending alert, budget per scan, pause dan konfigurasi runner independen antar platform. Bukan database bersama atau broadcast per-user.

Runner mendukung kandidat baru, spike, volume token lama, serta milestone 2x/5x teramati pada chain yang aktif. Target alert satu channel yang dikonfigurasi. Event disimpan sebelum pengiriman, dihapus dari antrean setelah send berhasil; kegagalan pengiriman mempertahankan antrean. Crash setelah Discord menerima pesan tetapi sebelum checkpoint dapat menyebabkan duplikasi saat retry, bukan jaminan exactly-once.

Menjalankan Telegram dan Discord sekaligus membuat dua adapter/poller dan dapat menambah pemakaian kuota GMGN/enrichment. Tidak ada cache/budget lintas proses. Konfigurasi tidak disinkronkan otomatis dan tidak memulihkan state historis Telegram ke Discord.

ONLINE dikirim setelah login Gateway dan pendaftaran command berhasil; bukan verifikasi provider live. OFFLINE dicoba pada SIGINT/SIGTERM setelah request berjalan ditunggu dan checkpoint dicoba, sebelum koneksi Discord ditutup. SIGKILL, mati listrik, server mati, atau jaringan terputus tidak menjamin pesan OFFLINE. Tidak ada monitor eksternal Discord pada implementasi ini.

Jika bot tidak membalas, cek token, guild/channel allowlist, Message Content Intent dan izin embed/send. Jika slash command tidak muncul, cek undangan `applications.commands`, guild yang dikonfigurasi, dan log startup. Jika runner tidak muncul, cek `/status`, `/getconfig`, target channel, kuota provider, serta mode live. Format laporan mock tetap berlabel demo, bukan data token asli.
