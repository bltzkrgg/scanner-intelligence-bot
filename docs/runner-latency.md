# Latensi Notifikasi Runner

## Penyebab yang Ditemukan di Kode

1. Runtime sebelumnya menunggu `runner.cycle()` selesai untuk semua token dan chain sebelum mengirim antrean. Kandidat pertama ikut menunggu query token-token berikutnya.
2. Discovery Solana menggunakan TTL enrichment default 300 detik. Polling 60 detik dapat membaca daftar discovery yang sama selama lima menit.
3. Semua tracked token satu chain diperiksa sebelum pindah chain. Backlog Solana bisa menahan BSC/RH.
4. Enrichment Tracker, Helius, MadeOnSol dan FOMO sebelumnya dijalankan berurutan. HTTP per endpoint dibatasi delapan detik, tetapi beberapa timeout dapat menumpuk.
5. Query CLI GMGN tetap memakai antrean serial dan jeda 1.2 detik setelah request selesai. Snapshot biasanya membutuhkan info + security, ditambah holders jika aktif. Ini mengonsumsi waktu dan kuota; menurunkan polling bukan berarti query selesai lebih cepat.

Ini temuan dari alur program, bukan pengukuran di VPS pengguna.

## Perubahan

- Antrean yang sudah tersimpan diperiksa sebelum polling; setelah setiap observasi selesai disimpan, runtime dapat langsung mengirim tanpa menunggu seluruh siklus.
- Counter pengiriman dibagi antar flush dalam scan yang sama. `maxPerScan` tidak kembali nol pada setiap callback. Counter chain direset ketika scan chain berikutnya benar-benar dimulai; kuota awal juga mencakup backlog yang dikirim saat startup.
- Pengiriman tetap satu per satu, dengan jeda minimal 1.1 detik yang berlaku lintas flush. Timeout Telegram dibatasi lima detik, event gagal tetap tersimpan, dan retry memakai jeda minimal lima detik atau `retry_after` Telegram yang lebih besar.
- Discovery Tracker memakai cache 15 detik, terpisah dari TTL enrichment. Filter serta interval `/setconfig` tidak diubah. Pemanggilan discovery tetap mengikuti jadwal runner; cache 15 detik bukan polling baru setiap 15 detik.
- Token discovery didahulukan dalam antrean setiap chain; pemeriksaan token bergiliran antar-chain. Discovery semua chain yang jatuh tempo tetap dikumpulkan terlebih dahulu.
- Helius dan FOMO berjalan bersama jalur Tracker/developer. MadeOnSol Solana tetap menunggu alamat deployer dari Tracker bila diperlukan. Semua enrichment selesai/timeout sebelum snapshot dievaluasi; blok keamanan GMGN/Helius tidak dilewati demi kecepatan.
- State tetap atomic dan snapshot antrean tidak diganti data masa depan. Shutdown menunggu siklus serta pengiriman aktif sebelum checkpoint, dengan deadline shutdown yang sudah ada.

## Mengukur di Server

Setelah update dan restart, tunggu satu siklus selesai lalu jalankan `/status`. Output menambahkan durasi siklus, jumlah query token, waktu discovery gabungan, dan query/observasi token terlama. Pengukuran per token mencakup pembacaan provider serta penyimpanan observasi; durasi siklus juga mencakup pengiriman streaming. Metadata `cycleTiming` disimpan di state dan tersedia setelah restart. State lama mendapat nilai null sampai siklus berikutnya selesai.

Gunakan `/getconfig` untuk melihat interval dan `maxPerScan`, serta `/runners` atau `/status` untuk jumlah antrean dan error pengiriman terakhir. `/status` juga menampilkan usia snapshot tertua yang masih antre (bukan murni waktu tunggu Telegram). Bila antrean terus bertambah, kuota kirim, izin Telegram atau lambatnya query perlu diperiksa; peningkatan throughput tidak boleh membuang event.

```bash
git pull --ff-only
pnpm build
pm2 restart ecosystem.config.cjs --only scanner-telegram --update-env
```

Masih ada latensi dari polling (default 60 detik), pemrosesan/indexing provider, query GMGN, enrichment dan antrean Telegram. `maxPerScan=5` dapat menahan event berlebih sampai scan berikutnya. Belum memakai WebSocket discovery dan belum ada jaminan real-time atau SLA detik tertentu. Teks event tetap berdasarkan snapshot saat query, bukan harga ketika pesan tiba.

Tes lokal memakai request mock, deferred promise dan fake timer untuk memastikan pengiriman sebelum siklus selesai, kuota bersama, discovery TTL, query independen, retry/timeout dan outbox. Tidak ada klaim benchmark latensi VPS tanpa data server.
