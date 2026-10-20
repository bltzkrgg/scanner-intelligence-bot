# Alert Volume Token Lama

Solana, BSC, dan Robinhood Chain memakai jalur volume independen dari filter kandidat baru. Token berumur sehari atau berbulan-bulan dapat menghasilkan alert; umur DEX yang tidak tersedia juga tidak menggagalkan jalur ini. ETH belum didukung.

## Syarat dan Jenis Alert

- Default volume rolling 5 menit >= $150.000 dan likuiditas >= $10.000.
- Harga positif dari GMGN live dan tidak diblokir keamanan provider. Blok honeypot, wash trading, authority, atau security yang diperlukan tetapi tidak tersedia tetap dihormati.
- Tidak mensyaratkan minimum total fees, swaps, market cap, umur maksimum, atau baseline. Volume 24 jam tidak dipakai menggantikan volume 5 menit yang kosong.
- `VOLUME TINGGI TERDETEKSI`: pertama kali ditemukan di atas ambang, tanpa bukti crossing atau baseline spike.
- `VOLUME TEMBUS BATAS`: volume sebelumnya yang teramati di bawah ambang, sekarang >= ambang. Ini crossing antar sampel, bukan waktu crossing tick-by-tick.
- `VOLUME SPIKE`: volume >= ambang dan rasio terhadap baseline >= multiplier. Jika crossing sekaligus spike, status spike diprioritaskan.

Baseline adalah rata-rata tiga sampel rolling 5m sebelumnya yang tidak tumpang tindih. Jarak akhir sampel minimal lima menit; setiap sampel harus berumur 5-30 menit dari observasi sekarang. Butuh sekitar 15 menit pemanasan. Baseline nol/belum siap tidak menghasilkan klaim spike; alert volume tinggi/crossing tetap bisa dikirim. Angka null tetap N/A, bukan nol.

Token baru yang sekaligus lolos filter kandidat dan volume hanya mengirim satu kandidat pada observasi pertama. Token dengan umur >= satu hari atau umur tidak diketahui memprioritaskan pesan volume jika kedua filter lolos. Pada observasi berikutnya crossing/spike dapat menghasilkan event volume baru sesuai cooldown. Rule spike legacy Solana/BSC tetap berjalan untuk volume di bawah ambang fitur baru, atau ketika fitur baru dimatikan; tidak melewati cooldown fitur baru untuk token di atas ambang.

## Konfigurasi

Kelima key berikut tersedia pada masing-masing prefix `tokenAlerts`, `bscAlerts`, dan `robinhoodAlerts`:

| Suffix | Default | Validasi |
| --- | --- | --- |
| `oldTokenVolume.enabled` | `true` | Boolean |
| `oldTokenVolume.minVolume5mUsd` | `150000` | Angka finite >= 0, USD |
| `oldTokenVolume.minLiquidityUsd` | `10000` | Angka finite >= 0, USD |
| `oldTokenVolume.spikeMultiplier` | `3` | > 1 hingga 1000 |
| `oldTokenVolume.cooldownMin` | `60` | Bilangan bulat 1-43200 menit |

```text
/getconfig tokenAlerts
/setconfig tokenAlerts.oldTokenVolume.enabled true
/setconfig tokenAlerts.oldTokenVolume.minVolume5mUsd 150000
/setconfig tokenAlerts.oldTokenVolume.minLiquidityUsd 10000
/setconfig tokenAlerts.oldTokenVolume.spikeMultiplier 3
/setconfig tokenAlerts.oldTokenVolume.cooldownMin 60

/setconfig bscAlerts.oldTokenVolume.enabled true
/setconfig bscAlerts.oldTokenVolume.minVolume5mUsd 150000
/setconfig robinhoodAlerts.oldTokenVolume.enabled true
/setconfig robinhoodAlerts.oldTokenVolume.minVolume5mUsd 150000
```

Hanya admin `TELEGRAM_ADMIN_IDS` yang dapat mengubahnya. Tersimpan di `RUNNER_STATE_FILE`, tanpa restart. Mengganti prefix memberi pengaturan chain terpisah, termasuk alamat EVM yang sama. Polling tetap memakai `<prefix>.pollIntervalSec` (default 60 detik); kuota pesan tetap berbagi `<prefix>.maxPerScan` (default 5) dengan kandidat/milestone.

Prasyarat tetap `GMGN_PROVIDER=cli`, `RUNNER_ENABLED=true`, chain di `ENABLED_CHAINS`, `<prefix>.enabled=true`, runner tidak dijeda, dan `TELEGRAM_RUNNER_CHAT_ID` benar. Tidak perlu key `.env` baru. Alert dikirim ke tujuan runner tersebut, bukan seluruh pengguna bot secara otomatis.

## Deduplikasi dan Kapasitas

Cooldown dihitung per chain+CA sejak event volume (atau kandidat yang sekaligus memenuhi filter volume) disimpan. Lonjakan selama cooldown tidak menghasilkan pesan baru. Sesudah cooldown, volume tinggi yang terus stabil tidak diulang: harus ada crossing baru atau spike yang memenuhi rasio baseline lagi. Crossing yang terjadi selama cooldown tidak diantrekan untuk dikirim belakangan.

Sampel, volume terakhir, cooldown, dan event antrean disimpan atomik. Event menyimpan threshold/baseline saat deteksi, bukan memakai config baru saat retry. Gagal kirim Telegram mempertahankan event; restart tidak menghapus cooldown. Pengiriman setidaknya sekali: proses mati sesudah Telegram menerima tetapi sebelum acknowledgment tersimpan dapat menghasilkan duplikat.

Menonaktifkan `oldTokenVolume.enabled` menahan event volume yang belum terkirim, bukan menghapusnya; jenis event lain tetap berjalan. Mengaktifkannya kembali melanjutkan antrean. Histori milestone dan harga awal tetap dipertahankan.

Daftar token tersimpan maksimal 50 per chain. Dengan fitur ini aktif, token tersimpan tetap di-query walaupun deteksi sudah lewat tujuh hari. Ketika daftar penuh, alert volume dari discovery masih dapat disimpan/dikirim sebagai event, tetapi token itu tidak ditambahkan ke pemantauan/milestone permanen. Baseline/deduplikasi dibatasi 500 token paling baru gabungan chain; token yang sudah terbuang lalu ditemukan lagi dapat dianggap deteksi pertama. Antrean maksimal 1.000 event, tidak dibuang diam-diam ketika pengiriman gagal.

Discovery yang ada: maksimal 10 hasil trending GMGN interval 5m per chain; Solana menggunakan search terurut volume5m Solana Tracker jika dikonfigurasi. Tidak ada filter umur pada discovery ini. Ini **bukan pemindaian seluruh token on-chain**: token di luar hasil provider dan daftar tersimpan dapat terlewat. Polling, durasi query, rate limit, indexing provider, dan kuota pengiriman tetap memengaruhi latensi. Tidak ada janji alert real-time atau setiap lonjakan terdeteksi.

## Upgrade dan Verifikasi

Cadangkan file state, lalu jalankan di direktori repository:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pm2 restart ecosystem.config.cjs --only scanner-telegram --update-env
```

State lama otomatis mendapat default baru tanpa menghapus histori/antrean. Jangan rollback memakai state yang sudah ditulis versi baru tanpa backup. Di Telegram cek `/status`, `/getconfig tokenAlerts`, `/getconfig bscAlerts`, dan `/getconfig robinhoodAlerts`. `/runner_test` menguji tujuan pengiriman, bukan membuktikan adanya lonjakan pasar atau keberhasilan setiap provider.

Judul alert mengikuti chain: `SOLANA VOLUME ALERT`, `BSC VOLUME ALERT`, atau `ROBINHOOD VOLUME ALERT`. Format memakai MARKET / ACTIVITY / INTELLIGENCE (bila tersedia) / MOMENTUM / STATUS / CA tanpa kotak copy, serta tombol GMGN / Detail Runner / Salin CA. Umur besar ditulis dalam hari, bukan ribuan menit; data lama tetap diberi peringatan tertunda. Nilai baseline/rasio yang belum tersedia tidak direkayasa.
