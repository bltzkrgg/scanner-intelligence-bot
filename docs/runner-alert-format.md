# Format Notifikasi Token Runner

Alert memakai teks HTML biasa dengan judul dan nilai tebal, struktur pohon MARKET / ACTIVITY / STATUS, dan tombol Telegram. Tidak memakai `pre` atau `code`, sehingga tidak muncul header copy pada blok pesan. CA tetap lengkap; tombol Salin CA tetap tersedia.

Contoh ilustrasi, bukan hasil deteksi nyata (judul bagian dan nilai ditampilkan tebal di Telegram):

```text
🟣 SOLANA TOKEN RUNNER

💊 EXAMPLE • 18m
Solana | GMGN

┌ MARKET
├ Price     : $0.00042
├ MC        : $420K
├ Vol 5m    : $185K
├ Swaps 5m  : 120
├ Fees      : 12.5 SOL
└ Liquidity : $65K

┌ ACTIVITY
├ Flow 1h  : Buy 56% • Sell 44%
├ Top 10   : 14.51%
├ Wallets  : N/A
└ Dex Paid : N/A

┌ STATUS
└ 🟢 SOLANA QUALIFIED
   VOL • MC • FEES • AGE

CA
<CA lengkap>
```

Baris Data event, Ref, penjelasan N/A dan disclaimer umum dihapus dari pesan. Timestamp dan Event ID tetap tersimpan pada state/outbox untuk deduplikasi. Catatan risiko spesifik provider dan peringatan ALERT TERTUNDA untuk event lebih dari 15 menit tetap ditampilkan. Snapshot antrean tidak diisi ulang dengan harga terbaru.

## Sumber Data

- Flow 1h dihitung dari proporsi jumlah transaksi beli/jual satu jam pada snapshot, bukan volume USD atau flow lima menit. Persentase dibulatkan ke bilangan bulat dan totalnya 100%. Jika salah satu jumlah tidak tersedia atau total transaksi nol, hasilnya N/A.
- Top 10 adalah persentase kepemilikan supply.
- Wallets dan Dex Paid masih N/A karena rincian wallet dan status DEX paid belum tersimpan pada snapshot runner. Jumlah smart money holder tidak dipakai sebagai pengganti rincian wallet.
- Subjudul memakai jaringan dan GMGN. Nama token panjang/nama DEX belum tersimpan pada snapshot; bot tidak mengarang PumpSwap atau nama pool dari simbol token.
- Umur adalah umur DEX/migration yang tersedia, bukan umur pembuatan token. Jika tidak tersedia, umur tidak ditampilkan.
- Angka pasar memakai K/M/B/T; fees dibulatkan maksimal dua desimal hanya untuk tampilan, kecuali fees positif di bawah 0.01 memakai hingga delapan desimal. Nilai mentah dan filter tidak berubah.
- Nilai kosong memakai N/A tanpa unit; nol yang diketahui tetap nol. Unit fees harus cocok dengan jaringan.

## Jaringan dan Status

Solana memakai judul ungu dan fees SOL; BSC kuning dan fees BNB; Robinhood hijau dan fees ETH. Kandidat Solana/BSC memakai VOL / MC / FEES / AGE, sedangkan RH hanya VOL / FEES.

QUALIFIED berarti event lolos filter saat deteksi dan metrik wajib lengkap, bukan evaluasi ulang dengan config sekarang atau jaminan keamanan/profit. Event rule lama memakai HISTORI DETEKSI LAMA. Data wajib hilang tidak menghasilkan QUALIFIED.

Spike memakai SOLANA/BSC VOLUME SPIKE dengan lonjakan dan baseline pada baris terpisah. Milestone memakai 2X/5X TERAMATI dengan kelipatan aktual dan harga awal. Penjelasan histori lama dan milestone tetap ditampilkan agar tidak disalahartikan sebagai kandidat baru.

## Tombol dan Klien

```text
[ GMGN ]       [ Detail Runner ]
[ Salin CA ]
```

GMGN mengikuti jaringan token. Detail Runner membuka data terkini dan histori chain+CA. Salin CA memakai copy native Telegram. Explorer dan Refresh tetap tidak muncul pada alert runner; laporan scan biasa tidak berubah. Callback pesan lama tetap didukung.

Mobile dan desktop menerima HTML dan keyboard yang sama. Teks biasa dapat membungkus sesuai layar tanpa code block; font proporsional tidak menjamin titik dua sejajar persis pada semua klien. Tidak ada CSS atau deteksi perangkat pada pesan bot.

Teks provider di-escape dan preview tautan dimatikan. Format berlaku pada pengiriman berikutnya, bukan mengedit pesan lama. Pengujian lokal memakai renderer dan transport Telegram mock, bukan screenshot aplikasi Telegram asli. `/runner_test` bukan kandidat palsu.

Pengaturan filter: [runner-config.md](runner-config.md).
