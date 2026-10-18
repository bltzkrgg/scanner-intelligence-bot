# Aktivasi Data Live dan Token Runner di Telegram

Fitur versi ini: scan live Solana/BSC/Robinhood Chain, deteksi kandidat berdasarkan data pasar/label smart money GMGN, histori harga, serta alert ke satu chat Telegram yang dikonfigurasi. Untuk aktivasi BSC/RH dan alert, lihat [panduan multichain](multichain-and-alerts.md). Bank wallet buatan user, Discord, dan Ethereum belum termasuk. PostgreSQL tidak diperlukan.

## 1. Update Bot

Hentikan proses terminal lama dengan Ctrl+C. Jika memakai systemd, hentikan service sebelum update:

```bash
sudo systemctl stop scanner-telegram
```

Lalu jalankan sebagai user yang memiliki repository:

```bash
cd ~/scanner-intelligence-bot
source ~/.nvm/nvm.sh
nvm use 24
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
pnpm test
npm install -g gmgn-cli@1.6.7
gmgn-cli --version
```

Jangan menyalin `.env.example` ke `.env` saat update karena dapat menimpa token yang sudah diisi. Edit `.env` yang ada.

## 2. Konfigurasikan Query Live

Ikuti pembuatan API key query pada [panduan resmi GMGN](https://github.com/GMGNAI/gmgn-skills#3-get-your-own-api-key). Gunakan API key sendiri untuk menjalankan bot; public demo key hanya untuk pengujian. Tidak perlu private key wallet atau transaksi untuk fitur ini.

```dotenv
GMGN_PROVIDER=cli
GMGN_API_KEY=ISI_API_KEY_ANDA
RUNNER_ENABLED=false
```

Periksa koneksi melalui adapter aplikasi, bukan hanya CLI:

```bash
pnpm gmgn:check So11111111111111111111111111111111111111112 --discovery
```

Output yang benar berisi `snapshot.source: "gmgn-cli"`, identitas WSOL, harga/likuiditas token, evaluasi runner, dan daftar `discovery`. Ulangi dengan CA yang ingin diperiksa:

```bash
pnpm gmgn:check 7UAWdJjrBykopzco6bCBmMLdggaiec6bd4bTKmQqpump
```

Nama dan data harus sesuai CA dari provider. Harga berubah mengikuti waktu query. Nilai `null` berarti belum tersedia, bukan nol. WSOL atau token lain tidak harus lolos kriteria kandidat runner. `token security` dapat tidak tersedia walaupun `token info` berhasil; jika demikian runner tidak melabeli token itu kandidat.

Jika command gagal, perbaiki key, akses paket GMGN, jaringan atau PATH terlebih dahulu. Bot tidak beralih diam-diam ke data contoh. Akses ditolak atau rate limit memicu cooldown lokal 5 menit; CLI retry dinonaktifkan dan request diantre dengan jarak minimal 1,2 detik. Kemampuan paket/API GMGN tetap menentukan data yang tersedia.

## 3. Dapatkan User ID Admin

Dengan `RUNNER_ENABLED=false`, jalankan bot:

```bash
pnpm telegram:dev
```

Buka Telegram dan kirim `/chatid`. Gunakan **User ID** untuk `TELEGRAM_ADMIN_IDS`. Chat ID berbeda fungsinya: itu tujuan notifikasi startup, bukan otorisasi admin. Di chat pribadi nilainya bisa sama; di grup biasanya berbeda.

Hentikan proses dengan Ctrl+C, lalu tambahkan pada `.env`:

```dotenv
GMGN_PROVIDER=cli
GMGN_API_KEY=ISI_API_KEY_ANDA
RUNNER_ENABLED=true
RUNNER_INTERVAL_SECONDS=300
RUNNER_STATE_FILE=data/runners.json
TELEGRAM_ADMIN_IDS=123456789
TELEGRAM_STARTUP_CHAT_ID=123456789
TELEGRAM_RUNNER_CHAT_ID=123456789
ENABLED_CHAINS=sol,bsc,robinhood
```

Ganti angka contoh dengan ID Anda. Beberapa admin dipisahkan koma tanpa spasi. `RUNNER_ENABLED=true` dengan mode mock atau tanpa admin ID membuat startup ditolak untuk mencegah pemantauan palsu/tanpa pengelola.

## 4. Mulai dan Aktifkan Pemantauan

```bash
pnpm telegram:dev
```

Atau, untuk instalasi yang sudah memiliki service:

```bash
sudo systemctl start scanner-telegram
sudo journalctl -u scanner-telegram -n 50 --no-pager
```

Pastikan path Node, pnpm, dan gmgn-cli tersedia pada PATH service systemd. Periksa dengan `command -v node`, `command -v pnpm`, dan `command -v gmgn-cli`, lalu sesuaikan unit seperti pada [tutorial instalasi](installation.md#10-jalankan-terus-di-server-ubuntu). Jangan jalankan terminal dan service bersamaan.

Kirim `/runners` untuk status worker. Jika state lama dijeda, admin mengirim `/runner_on`. Worker memulai discovery saat startup; selanjutnya menunggu interval yang dikonfigurasi setelah setiap siklus selesai. Saat diaktifkan kembali dengan command, query berjalan pada jadwal siklus berikutnya. Tidak ada siklus yang tumpang tindih.

## Command

| Input | Fungsi |
| --- | --- |
| CA Solana langsung atau `/scan <CA>` | Laporan data live dan evaluasi runner |
| `/runner <CA>` | Evaluasi terkini serta histori kandidat bila sudah terdeteksi |
| `/runners` atau `/runners <halaman>` | Status worker, error terakhir, dan 4 histori per halaman |
| `/runner_on` | Admin: lanjutkan worker jika RUNNER_ENABLED=true |
| `/runner_off` | Admin: jeda worker; histori tetap tersimpan |
| `/runner_remove <CA>` | Admin: hapus histori CA agar kapasitas tersedia |
| `/runner_remove <bsc|rh> <CA>` | Admin: hapus histori dan alert tertunda pada jaringan terkait |
| `/runner_test` | Admin: uji pengiriman ke TELEGRAM_RUNNER_CHAT_ID tanpa menunggu kandidat |
| `/status` | Mode data dan status pemantauan |
| `/chatid` | Chat ID dan User ID |

`/runner_on` tidak dapat mengganti konfigurasi provider atau API key. Perubahan `.env` memerlukan restart. Menghapus histori bukan blacklist; discovery berikutnya bisa memasukkan CA itu lagi dengan titik deteksi baru.

## Aturan Kandidat

Runner Score bukan skor risiko atau probabilitas profit. Ini rule eksperimen yang transparan, belum dikalibrasi lewat backtest.

| Komponen | Poin |
| --- | --- |
| Likuiditas >= USD 50.000 / >= USD 25.000 | 25 / 15 |
| Rasio buy/sell 1j >= 1,5 / >= 1,2 | 25 / 15 |
| Perubahan 1j antara 10%-100% / positif sampai 200% lainnya | 20 / 10 |
| Smart money holder berlabel GMGN >= 3 | 15 |
| Top 10 holder <= 25% / <= 35% | 15 / 5 |

Syarat kandidat: skor >= 70, likuiditas >= USD 25.000, minimal 50 transaksi buy+sell 1j, perubahan 1j positif maksimal 200%, top 10 <= 35%, harga valid dan field penilaian tersedia. Insider holdings jika diketahui harus <= 12%; jika tidak tersedia, ketidakpastian ditampilkan dan tidak dianggap nol. Kandidat tidak berarti token aman.

Data security harus tersedia. Indikasi honeypot, wash trading atau otoritas mint/freeze yang masih aktif memblokir label kandidat. Pemeriksaan ini terbatas pada data provider, bukan audit keamanan menyeluruh.

Bank wallet milik user belum digunakan. Angka smart money saat ini adalah label agregat GMGN. Volume bundler tidak dipakai sebagai persentase supply; jumlah sniper tidak dipakai sebagai persentase kepemilikan.

## Cara Discovery dan Histori Bekerja

Worker mengambil maksimal 10 token trending per jaringan pada ENABLED_CHAINS per siklus, memverifikasi token info/security, lalu menyimpan yang lolos. Scan CA juga dapat mendaftarkan kandidat ketika worker aktif. Ini cakupan terbatas, bukan pemindaian seluruh token di semua jaringan.

Maksimal 50 kandidat tersimpan per jaringan. Saat kapasitas suatu jaringan penuh, kandidat baru di jaringan itu tidak ditambahkan; admin dapat mencadangkan file dan menghapus histori tertentu. Kandidat lama tetap diperbarui walaupun tidak trending sampai 7 hari sejak deteksi. Sesudahnya histori tetap tersimpan tanpa refresh otomatis; query `/runner <chain> <CA>` dapat memperbarui catatan jika monitoring aktif.

Harga pertama diambil saat token pertama kali memenuhi syarat dan disimpan, bukan harga peluncuran. Sistem menyimpan harga terkini, puncak teramati, max drawdown dari puncak teramati, jumlah observasi, dan waktu pencapaian 2x/5x jika tercatat. Sampel berkala dapat melewatkan spike di antara query; angka ini bukan ATH atau maksimum drawdown seluruh tick pasar. Data lebih dari 15 menit diberi label DATA LAMA.

Status kandidat diperbarui berdasarkan data terbaru; label MELEMAH / DATA BELUM LENGKAP berarti syarat saat ini tidak terpenuhi. Kegagalan provider mempertahankan histori lama beserta timestamp aslinya, bukan membuat observasi baru.

## Penyimpanan dan Backup

State ditulis ke `RUNNER_STATE_FILE` memakai temporary file dan atomic rename. Status jeda serta histori bertahan saat restart. Direktori `data/` diabaikan Git dan harus dapat ditulis oleh user service. Gunakan satu proses bot untuk satu file; file ini tidak mendukung beberapa penulis/server sekaligus.

State versi 1 dimigrasikan menjadi versi 2: histori lama dianggap Solana dan tidak menghasilkan alert kandidat retrospektif. Antrean alert baru ikut disimpan. Simpan backup sebelum upgrade; versi bot lama tidak dapat membaca state versi 2.

Backup saat service dihentikan:

```bash
sudo systemctl stop scanner-telegram
cp data/runners.json data/runners.backup.json
sudo systemctl start scanner-telegram
```

Sesuaikan path jika memakai file khusus. Jika file belum ada karena belum ada aktivitas tersimpan, belum ada yang perlu dicadangkan. State rusak menyebabkan startup gagal dan tidak ditimpa otomatis; hentikan service dan pulihkan backup yang valid.

## Yang Tidak Lagi Ditampilkan

Skor historis 72/100, klasifikasi CUKUP MENARIK, win rate 50%, dan median return 7,5% dari fixture lama tidak diterbitkan lagi. `historicalScore`, `classification`, dan statistik pembanding bernilai `null` pada scanner default, sampai ada benchmark riil dan semua metrik yang diperlukan. Runner tetap dapat dievaluasi sebagai rule pasar terpisah.
