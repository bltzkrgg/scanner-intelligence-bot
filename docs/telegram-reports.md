# Laporan Telegram Ringkas

Scan CA langsung atau `/scan <chain> <CA>` sekarang memakai tampilan ringkas (pilihan 1). Berlaku untuk Solana, BSC dan Robinhood Chain; mode mock tetap menampilkan peringatan demo tanpa skor atau tombol analisis live. HTTP API dan logika penilaian tidak berubah karena tampilan ini.

## Isi Laporan

Identitas token dan jaringan, CA monospace, harga, market cap, likuiditas, volume 24j, momentum 1j/6j, buy/sell, holder, smart money berlabel provider, Runner Score, status filter alert admin, ringkasan risiko dan waktu data WIB.

Jumlah besar memakai K/M/B/T; persentase dibulatkan maksimal dua desimal dan harga kecil tetap memiliki presisi yang memadai (notasi ilmiah untuk harga sangat kecil). Nilai yang tidak tersedia tidak ditulis sebagai nol. Waktu ditampilkan dari timestamp observasi, bukan diganti waktu klik tanpa query baru. CA tetap lengkap agar mudah disalin.

Runner Score adalah rule eksperimen, bukan probabilitas profit. Filter alert admin dinilai terpisah menggunakan config aktif; bisa lolos meskipun rule skor tidak lolos. Jika runner global dijeda/nonaktif, laporan menyatakannya. Kelulusan filter tidak menjamin pesan terkirim: prasyarat worker, tujuan notifikasi, kapasitas histori dan status pengiriman tetap berlaku. Skor historis tidak dibuat jika benchmark riil belum ada.

Warning penting seperti blok honeypot tetap muncul pada ringkasan. Metrik insider/bundler/sniper, riwayat developer, smart money flow dan LP lock yang belum tersedia tidak menjadi tersedia hanya karena format berubah; rincian ada pada Detail Risiko.

## Enam Tombol

| Tombol | Perilaku |
| --- | --- |
| Refresh | Query ulang provider melewati cache lokal bot, lalu edit pesan ringkasan yang sama; tombol dipertahankan |
| Detail Risiko | Kirim pesan detail terpisah: kepemilikan, developer, smart money, LP lock, serta catatan data/risiko |
| Status Runner | Kirim pesan terpisah: filter kandidat baru beserta alasan, skor eksperimen, status worker, volume5m/fees/umur DEX dan histori CA pada chain itu |
| Buka GMGN | Buka halaman token GMGN untuk jaringan terkait |
| Explorer | Solscan untuk Solana, BscScan untuk BSC, Blockscout Robinhood Chain untuk RH |
| Salin CA | Tombol copy native Telegram; CA monospace pada laporan tetap menjadi cadangan untuk klien lama |

Susunan keyboard:

```text
[ Refresh       ] [ Detail Risiko ]
[ Status Runner ] [ Buka GMGN     ]
[ Explorer      ] [ Salin CA      ]
```

Detail tidak mengganti ringkasan, sehingga pengguna tetap bisa kembali ke pesan awal. Ini bukan tampilan tab dari pilihan 3. Preview tautan dinonaktifkan agar laporan tidak melebar oleh kartu situs. Warna dan bentuk tombol mengikuti klien Telegram.

Callback menyimpan chain dan CA, bukan cache laporan dalam RAM, sehingga tombol masih dapat digunakan setelah restart selama Telegram mengizinkannya dan jaringan itu tetap diaktifkan. Data untuk detail boleh memakai cache lokal 10 detik; Refresh melewatinya. Query simultan token yang sama tetap digabung, termasuk saat refresh; batas request dan cooldown GMGN tetap berlaku. Permintaan bertumpuk pada satu pesan ditahan selama aksi sebelumnya berjalan.

Jika provider gagal, laporan lama tidak ditimpa; bot mengirim keterangan gagal dan pengguna dapat mencoba lagi. Jika Telegram tidak mengizinkan edit pesan lama, kirim CA ulang. Penggantian tampilan tidak otomatis mengubah pesan lama yang belum punya tombol.

Kegagalan menyimpan state runner tidak menghilangkan laporan pasar: bot tetap mengirim laporan dengan peringatan bahwa observasi runner gagal tersimpan. Histori lama tidak diklaim sebagai observasi terbaru.

## Update Server

Cadangkan state sesuai [panduan runner](runner-config.md), lalu jalankan dari root repository:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm test
pm2 restart scanner-telegram --update-env
```

Kirim ulang CA. Periksa enam tombol, status filter terpisah dari skor, serta timestamp WIB. Tekan Refresh untuk memeriksa pembaruan pesan yang sama. Pengujian lokal memakai Telegram API mock; uji nyata di chat bot tetap diperlukan setelah deploy.

Referensi teknis: [Telegram InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton), [CopyTextButton](https://core.telegram.org/bots/api#copytextbutton), dan [explorer resmi Robinhood Chain](https://docs.robinhood.com/chain/connecting/).
