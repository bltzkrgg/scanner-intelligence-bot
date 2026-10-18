# Aktivasi Solana, BSC, RH dan Notifikasi Runner

Kode mendukung `sol` (Solana), `bsc` (BNB Smart Chain), dan `robinhood` (Robinhood Chain/RH). `rh` merupakan alias command, bukan nilai ENABLED_CHAINS. Dukungan query mengikuti paket, API key, dan ketersediaan data GMGN; startup tidak membuktikan semua endpoint sehat.

## Update VPS

Hentikan proses lama sebelum update. Jika memakai systemd:

```bash
sudo systemctl stop scanner-telegram
```

Jika sebelumnya sudah ada histori, cadangkan `data/runners.json` (atau path RUNNER_STATE_FILE Anda) sebelum upgrade. Jangan menghapus histori lama.

```bash
cd ~/scanner-intelligence-bot
source ~/.nvm/nvm.sh
nvm use 24
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
pnpm test
npm install -g gmgn-cli@1.6.7
nano .env
```

Tambahkan/perbarui variabel di `.env` yang ada, tanpa menimpa token:

```dotenv
GMGN_PROVIDER=cli
GMGN_API_KEY=API_KEY_QUERY_ANDA
ENABLED_CHAINS=sol,bsc,robinhood
RUNNER_ENABLED=true
RUNNER_INTERVAL_SECONDS=300
RUNNER_STATE_FILE=data/runners.json
TELEGRAM_ADMIN_IDS=USER_ID_ADMIN
TELEGRAM_STARTUP_CHAT_ID=CHAT_ID_STARTUP
TELEGRAM_RUNNER_CHAT_ID=CHAT_ID_TUJUAN_ALERT
```

Ganti placeholder ID dengan angka sebenarnya; jangan menyimpan teks placeholder pada variabel ID. `/chatid` menampilkan Chat ID dan User ID. Untuk chat pribadi mulai percakapan dengan bot lebih dulu; untuk grup tambahkan bot dan berikan izin mengirim pesan. Channel memerlukan bot sebagai admin dengan izin posting.

Tujuan startup dan runner boleh sama, tetapi kedua variabel terpisah. Tanpa TELEGRAM_RUNNER_CHAT_ID, tidak ada alert runner yang dikirim walaupun worker aktif. Bot tidak mengirim ke semua pengguna secara otomatis.

Perubahan `.env` memerlukan restart. Untuk instalasi systemd yang sudah dibuat:

```bash
sudo systemctl start scanner-telegram
sudo journalctl -u scanner-telegram -n 50 --no-pager
```

Atau jalankan dari terminal dengan `pnpm telegram:dev`, tanpa service lain memakai token yang sama. PATH service harus mencakup Node, pnpm, dan gmgn-cli.

## Cara Scan

| Input Telegram | Perilaku |
| --- | --- |
| CA Solana langsung | Scan Solana |
| `0x` + 40 karakter hex | Tombol pilihan BSC / Robinhood Chain |
| `/scan bsc <CA>` atau `bsc:<CA>` | Scan BSC tanpa pilihan tambahan |
| `/scan rh <CA>` atau `rh:<CA>` | Scan Robinhood Chain |
| `/runner bsc <CA>` | Evaluasi dan histori runner BSC |
| `/runner rh <CA>` | Evaluasi dan histori runner RH |
| `/runners` atau `/runners 2` | Status worker dan histori semua jaringan, empat entri per halaman |
| `/runner_remove bsc <CA>` | Admin: hapus hanya histori/antrean BSC untuk CA tersebut |
| `/runner_on` / `/runner_off` | Admin: lanjutkan/jeda worker dan pengiriman alert |
| `/runner_test` | Admin: kirim pesan TES ke chat tujuan notifikasi |

Alamat `0x` saja tidak menentukan chain; bot tidak menebaknya. Jika hanya satu jaringan EVM diaktifkan, alamat EVM diarahkan ke jaringan itu. Jika tidak ada jaringan EVM yang aktif, bot menjelaskannya. Histori dan cache memakai chain + alamat; checksum/casing EVM dinormalisasi, sedangkan alamat Solana tidak diubah casing-nya.

Untuk API EVM, kirim chain eksplisit:

```json
{"mint":"0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c","chain":"bsc"}
```

## Verifikasi Data Live

Jika bot sudah aktif, hindari menjalankan banyak pemeriksaan CLI bersamaan dengan worker. Query berikut contoh read-only dan tidak melakukan transaksi:

```bash
pnpm gmgn:check sol So11111111111111111111111111111111111111112 --discovery
pnpm gmgn:check bsc 0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c --discovery
pnpm gmgn:check rh 0x5199ea953d71d6a5413be1b2efecd26aacab0000 --discovery
```

Jalankan satu per satu. Jika satu gagal dengan autentikasi/rate limit, berhenti dan ikuti cooldown; jangan terus menjalankan command berikutnya. Gunakan API key sendiri. Public demo key dapat ditolak atau dibatasi dan bukan jaminan akses produksi.

Output harus mencantumkan chain, alamat, sumber `gmgn-cli`, data token yang tersedia, dan daftar discovery jika berhasil. Respons security sama sekali tidak tersedia membuat runner menahan label kandidat. Pada BSC/RH, indikator mint/freeze Solana tidak digunakan. BSC memerlukan status honeypot yang diketahui. GMGN dapat tidak menyediakan pemeriksaan honeypot pada RH; dalam kondisi itu kandidat momentum RH tetap dapat muncul, tetapi keterbatasan risiko ditampilkan dalam laporan dan alert. Indikasi honeypot/wash trading yang terdeteksi tetap memblokir kandidat di semua chain. Data tidak tersedia tidak diganti angka nol.

## Notifikasi Runner

Notifikasi yang dibuat:

1. Kandidat baru saat pertama memenuhi rule dan berhasil disimpan.
2. Pencapaian 2x dari harga awal deteksi yang teramati saat query.
3. Pencapaian 5x dari harga awal deteksi yang teramati saat query.
4. Volume spike Solana/BSC setelah baseline siap, sesuai config dan cooldown per token per jaringan.

Solana/BSC/RH memakai filter admin melalui `/setconfig`; contoh pesan terkini, seluruh key, dan mekanisme baseline ada di [runner-config.md](runner-config.md).

Tidak ada pesan untuk setiap perubahan harga. Angka 2x/5x bukan hasil dari harga peluncuran atau ATH. Kandidat bisa gagal, dan sampel berkala dapat melewatkan pergerakan di antara query. Tidak ada notifikasi transaksi wallet pada versi ini.

Contoh struktur alert (data ilustrasi, bukan token nyata):

```text
KANDIDAT TOKEN RUNNER BARU

BSC | EXAMPLE
CA: <CA>
Harga: $0.001
Market cap: $1,000,000
Likuiditas: $75,000
...
Lolos: filter alert admin. Bukan skor profit.
Detail: /runner bsc <CA>
Event ID: <identitas-event>
Harga berdasarkan sampel saat query. Kandidat bukan jaminan kenaikan atau sinyal beli.
```

Antrean alert disimpan bersama state sebelum pengiriman. Maksimal pesan per jaringan mengikuti maxPerScan masing-masing (default 5), dengan batas gabungan 50 per flush dan jeda antar pesan. Pesan gagal atau di luar kuota tetap antre untuk siklus berikutnya; error terlihat di `/runners` dan `/status`. Data event lebih dari 15 menit diberi label tertunda. Alert dari chain yang dinonaktifkan ditahan sampai chain diaktifkan lagi atau histori dihapus.

Pengiriman umumnya sekali per event, tetapi bukan jaminan exactly-once: crash setelah Telegram menerima pesan namun sebelum acknowledgment tersimpan dapat menghasilkan duplikat saat restart. Event ID membantu mengenalinya. Mengganti chat tujuan menyebabkan alert tertunda berikutnya dikirim ke tujuan baru. State lama versi 1 dimigrasikan tanpa mengirim ulang kandidat/milestone historis.

Untuk uji pengiriman, admin kirim `/runner_test`. Pesan ini ditandai TES dan tidak membuat kandidat palsu atau mengubah histori. Jika berhasil tetapi alert kandidat belum ada, periksa `/runners`: bisa belum ada token memenuhi syarat, runner dijeda, atau data provider belum lengkap.

## Cakupan dan Kapasitas

Worker mengambil maksimal sepuluh trending token per jaringan, lalu memantau kandidat tersimpan. Maksimal lima puluh kandidat disimpan per jaringan agar kapasitas Solana tidak menghabiskan ruang BSC/RH. Pemantauan otomatis berlangsung tujuh hari sejak deteksi. Tidak ada pemindaian seluruh token atau jaminan semua runner terdeteksi.

Rumus Runner Score sama sebagai baseline eksperimen pada ketiga jaringan, bukan model yang sudah dikalibrasi untuk masing-masing chain. Skor historis dan statistik profit tetap tidak diterbitkan tanpa benchmark riil. Bank wallet user, Ethereum, dan Discord belum termasuk.
