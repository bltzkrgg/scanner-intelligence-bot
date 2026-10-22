# Rencana Smart Wallet, Token Runner, dan Multichain

Scan live dan runner Solana/BSC/Robinhood Chain serta alert Telegram dan Discord tersedia; lihat [aktivasi multichain](multichain-and-alerts.md) dan [tutorial Discord](discord.md). Bank wallet user dan Ethereum masih rencana. Tutorial dasar ada di [installation.md](installation.md).

Konfigurasi alert Solana/BSC/RH lewat `/setconfig` dan volume spike Solana/BSC kini tersedia; lihat [mekanisme, key, dan contoh notifikasi](runner-config.md). Integrasi [multi-provider](providers.md) menambah Solana Tracker, Helius, MadeOnSol dan FOMO. Batasan smart money flow 1h, LP lock, posisi Meteora dan cluster lengkap dicatat pada panduan provider dan [backlog GMGN](gmgn-enrichment-backlog.md).

## Bank Smart Wallet Bersama

Wallet tambahan menjadi bank data bersama untuk mendeteksi token yang dibeli, dipegang, dan dijual oleh wallet tersebut. Rencana awal adalah user mengusulkan wallet dan admin menyetujui sebelum aktivitasnya memengaruhi skor. Kebijakan persetujuan ini masih perlu dikonfirmasi.

Simpan chain, alamat, label, sumber penambahan, status, dan waktu pembaruan. Worker mengambil aktivitas serta holdings sesuai akses provider; transfer masuk dibedakan dari pembelian. Indeks wallet-token memungkinkan pencarian token yang dimasuki wallet dan wallet yang terlibat dalam satu token.

Usulan bobot bank smart wallet adalah 20% dari skor gabungan, dengan komponen lain dinormalisasi. Bobot belum final dan perlu diuji dengan histori riil. Data tidak tersedia atau kedaluwarsa ditandai; jangan diubah menjadi sinyal nol. Wallet yang terkait perlu ditangani agar satu pelaku dengan banyak alamat tidak menggandakan pengaruh.

## Token Runner

Versi dasar sudah mencari kandidat dari trending GMGN dan scan CA, menyimpan titik deteksi, serta memperbarui histori performanya. Rule dan batas cakupan ada di [panduan runner](live-and-runner.md). Kandidat tidak berarti bot mendeteksi sebelum setiap kenaikan.

Pengembangan berikutnya adalah pemicu berdasarkan transaksi wallet dalam bank user, pertumbuhan holder, dan riwayat developer. Versi saat ini menggunakan likuiditas, buy/sell, perubahan harga, konsentrasi holder, security, dan jumlah smart money berlabel provider. Runner Score dipisahkan dari skor historis/risiko token.

Simpan harga, market cap, likuiditas, dan waktu pertama deteksi. Pantau perubahan harga, kenaikan maksimum, drawdown, serta aktivitas keluar wallet. Label 2x/5x baru diberikan setelah tercapai dari titik deteksi; ini bukan jaminan kenaikan. Evaluasi historis harus memakai informasi yang tersedia pada waktu penilaian dan menyertakan kandidat gagal.

## Telegram dan Discord

Kedua platform memakai layanan analisis dan adapter provider yang sama, tetapi proses dan file state runner terpisah. Discord mendukung CA langsung, slash command, pilihan chain, laporan embed, detail risiko, histori runner dan konfigurasi admin. Jalankan `pnpm discord:dev` atau `ecosystem.discord.config.cjs`; aplikasi bot, intent dan izin channel tetap harus dikonfigurasi. Bank wallet lintas platform, database bersama dan sinkronisasi filter belum diimplementasikan.

## Empat Jaringan

Target yang dibahas: Solana, BSC, Ethereum, dan Robinhood Chain. Bentuk alamat hanya petunjuk; token harus diverifikasi pada jaringan terkait. Jika alamat ditemukan pada beberapa jaringan, tampilkan pilihan chain. Kegagalan query provider tidak boleh dianggap sebagai bukti token tidak ada.

Identitas wallet/token memakai pasangan chain dan alamat. Aktivitas wallet serta benchmark dihitung per chain. Dukungan token, holdings, dan transaksi dari provider perlu diverifikasi per jaringan sebelum fitur dinyatakan siap.

## Urutan Implementasi yang Diusulkan

1. Konfirmasi cakupan runner dan kebijakan pengelolaan bank wallet.
2. Verifikasi akses dan bentuk data provider untuk token, holdings, serta transaksi tiap jaringan.
3. Tambahkan migrasi PostgreSQL, bank wallet, dan identitas chain-alamat.
4. Implementasikan sinkronisasi dengan pembatasan request, penanganan duplikasi, dan penanda kesegaran data.
5. Hubungkan bukti aktivitas wallet ke skor dan laporan.
6. Implementasikan deteksi runner dan histori performa sesuai scope yang disetujui.
7. Discord dan pemilihan chain tersedia; sinkronisasi bank wallet lintas platform masih rencana.
8. Uji lalu perbarui tutorial dengan command, environment, dan service yang benar-benar tersedia.

Alert kandidat runner dan milestone 2x/5x tersedia ke satu chat yang dikonfigurasi. Alert transaksi wallet dan broadcast per-user masih di luar scope versi ini.
