# Menu dan Submenu Telegram

Command tanpa argumen kini membuka tombol inline. Submenu mengganti pesan menu yang sama; laporan scan tetap dikirim sebagai pesan terpisah. Command berargumen seperti `/scan bsc <CA>`, `/runner rh <CA>`, `/getconfig tokenAlerts`, dan `/setconfig <key> <value>` tetap didukung.

## Navigasi

| Command | Tombol / alur |
| --- | --- |
| `/start` | Scan Token, Daftar Runner, Status Bot, Bantuan; Pengaturan dan Panel Admin khusus admin |
| `/scan`, `/runner` | Pilih chain aktif, kirim CA, atau Batal |
| `/runners` | Filter Semua/Solana/BSC/RH, empat token per halaman, Sebelumnya/Berikutnya, detail token |
| `/status` | Perbarui, Daftar Runner, Pengaturan bagi admin |
| `/help` | Scan Token, Daftar Runner, Pengaturan bagi admin, Menu Utama |
| `/chatid` | Salin Chat ID, Salin User ID, Menu Utama |
| `/getconfig`, `/setconfig` | Pilih jaringan, kelompok pengaturan, pilih field, preset atau Nilai Lain |
| `/runner_on`, `/runner_off` | Konfirmasi lanjut/jeda; bukan menghidupkan proses bot yang mati |
| `/runner_remove` | Pilih chain, input CA, konfirmasi hapus |
| `/runner_test` | Kirim pesan uji ke `TELEGRAM_RUNNER_CHAT_ID` |
| `/notification_test` | Kirim pesan uji ke `TELEGRAM_STARTUP_CHAT_ID` |

Daftar runner memakai histori tersimpan. Detail daftar menunjukkan waktu observasi; bukan query pasar baru. Untuk query live gunakan `/runner <chain> <CA>`. Hapus Histori hanya muncul untuk admin dan menghapus histori/antrean/baseline chain+CA setelah konfirmasi. Penghapusan bukan blacklist; discovery dapat menemukan token lagi.

Tombol laporan scan tetap Refresh / Detail Risiko / Status Runner / GMGN / Explorer / Salin CA. Tombol notifikasi runner tetap GMGN / Detail Runner / Salin CA: tidak menambahkan kembali Refresh atau Explorer pada notifikasi.

## Pengaturan

- Kandidat Baru: volume 5m, total fees native, serta market cap dan maksimum umur DEX untuk Solana/BSC.
- Volume Token Lama: ON/OFF, volume 5m, likuiditas, total fees native, multiplier, dan cooldown.
- Spike Legacy: multiplier, swaps, likuiditas, total fees native, dan cooldown. Volume/MC tetap mengikuti Kandidat Baru.
- Polling & Pengiriman: interval polling dan maksimum alert per scan.
- Alert Jaringan: ON/OFF di halaman jaringan; Lihat Semua Nilai menampilkan key asli.

Robinhood tidak memiliki Spike Legacy, minimum market cap atau maksimum umur kandidat. Menu `Volume / Spike Token Lama` Robinhood memakai satu set config untuk volume tinggi/crossing/spike, termasuk minimum fees ETH.

Pilih ON/OFF secara eksplisit. Untuk angka, pilih preset atau Nilai Lain lalu kirim angka. Nilai invalid tidak mengganti config lama; user dapat mencoba lagi atau Batal. Penyimpanan berlaku pada pengecekan berikutnya tanpa restart. Config tetap bersama untuk bot, bukan config pribadi per user.

## Minimum Total Fees

| Jenis alert | Solana | BSC | Robinhood |
| --- | --- | --- | --- |
| Kandidat Baru | `tokenAlerts.minTotalFeesSol` | `bscAlerts.minTotalFeesBnb` | `robinhoodAlerts.minTotalFeesEth` |
| Spike Legacy | `tokenAlerts.volumeSpikeMinTotalFeesSol` | `bscAlerts.volumeSpikeMinTotalFeesBnb` | Tidak tersedia |
| Volume Token Lama / spike-nya | `tokenAlerts.oldTokenVolume.minTotalFeesSol` | `bscAlerts.oldTokenVolume.minTotalFeesBnb` | `robinhoodAlerts.oldTokenVolume.minTotalFeesEth` |

Total fees GMGN adalah native SOL/BNB/ETH, bukan biaya rata-rata gas, USD, atau fees rolling 5 menit. Nilai finite >= 0, boleh pecahan. `0` menonaktifkan filter fees; field yang hilang tetap N/A, tidak diubah menjadi nol. Nilai positif memerlukan data fees >= minimum dan satuan native yang sesuai; data hilang atau salah unit tidak lolos. Mematikan fees tidak mematikan blok keamanan atau filter lain.

Default Kandidat Baru tetap 10 SOL / 0.5 BNB / 0.1 ETH. Saat membaca state lama, minimum Spike Legacy diwarisi dari fees kandidat chain itu, termasuk nilai custom; setelah itu nilainya independen. Default fees Volume Token Lama adalah 0 untuk ketiga chain agar upgrade tidak mendadak mengurangi alert.

```text
/setconfig tokenAlerts.volumeSpikeMinTotalFeesSol 5
/setconfig bscAlerts.volumeSpikeMinTotalFeesBnb 0.25
/setconfig tokenAlerts.oldTokenVolume.minTotalFeesSol 10
/setconfig bscAlerts.oldTokenVolume.minTotalFeesBnb 0.5
/setconfig robinhoodAlerts.oldTokenVolume.minTotalFeesEth 0.1
```

Aturan Volume Token Lama dan Spike Legacy terpisah: ketika volume tinggi tidak memenuhi filter token lama, spike legacy masih dapat lolos dengan filter dan fees-nya sendiri. Jika jalur volume token lama memenuhi syarat, cooldown-nya tidak dilewati memakai spike legacy. Untuk mengharuskan fees pada semua jenis alert, atur setiap minimum yang relevan, bukan hanya satu field.

## Akses dan Masa Berlaku

Menu terikat ke user, chat, dan pesan menu. User lain di grup tidak dapat memakai tombol menu tersebut; mereka harus membuka command sendiri. Setiap operasi admin memeriksa `TELEGRAM_ADMIN_IDS`, termasuk callback yang dimanipulasi dan input angka. Menyembunyikan tombol bukan satu-satunya proteksi.

Menu/input kedaluwarsa setelah 10 menit tidak dipakai. Satu user dalam satu chat mempunyai satu input aktif. Input dari user/chat lain tidak mengubah config. Navigasi/Batal atau command baru membatalkan input yang menunggu. Konfirmasi jeda/hapus hanya dapat digunakan sekali. Restart mengakhiri sesi menu, bukan menghapus config/histori.

## Upgrade

Cadangkan `RUNNER_STATE_FILE`. Tidak ada variabel `.env` baru. Prasyarat provider live, chain aktif, admin IDs, dan tujuan runner tetap berlaku.

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pm2 restart ecosystem.config.cjs --only scanner-telegram --update-env
```

Buka `/start` atau `/setconfig` lagi setelah restart. Jangan gunakan backup state versi baru untuk rollback tanpa memastikan versi lama dapat membaca field/event-nya. Pengujian menu dan filter memakai API/provider mock; keberhasilan tersebut tidak membuktikan akses provider live atau izin kirim dari VPS.
