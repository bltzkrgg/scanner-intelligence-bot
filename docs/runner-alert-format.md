# Format Notifikasi Token Runner

Alert Telegram memakai judul per jaringan, blok monospace MARKET / ACTIVITY / STATUS, angka ringkas, CA monospace dan inline keyboard. Ini mengubah presentasi, bukan threshold atau rule penilaian.

Contoh ilustrasi kandidat Solana (bukan hasil deteksi nyata):

```text
🟣 SOLANA TOKEN RUNNER

EXAMPLE · 18m DEX
Solana | GMGN

┌ MARKET
├ Price       : $0.00042
├ MC          : $420K
├ Vol 5m      : $185K
├ Swaps 5m    : 120
├ Fees        : 12.5 SOL
└ Liquidity   : $65K

┌ ACTIVITY
├ Buy/Sell 1h : 680 / 728
├ Top 10      : 14.51%
└ Smart Money : 118

┌ STATUS
└ 🟢 SOLANA QUALIFIED
  VOL 5m • MC • FEES • AGE

Hasil filter alert admin saat deteksi, bukan status terkini.

CA
<CA lengkap>

Data event: <waktu WIB>
Ref: <referensi pendek>
N/A = belum tersedia. Smart Money adalah label provider.
Filter momentum bukan audit risiko. Bukan rekomendasi beli/jual.
```

## Jaringan dan Status

- Solana: judul ungu SOLANA TOKEN RUNNER, fees SOL, kandidat memakai VOL 5m / MC / FEES / AGE.
- BSC: judul kuning BSC TOKEN RUNNER, fees BNB, kandidat memakai VOL 5m / MC / FEES / AGE.
- Robinhood: judul hijau ROBINHOOD TOKEN RUNNER, fees ETH, kandidat memakai VOL 5m / FEES. Tidak mengklaim lolos syarat umur/market cap yang tidak menjadi filter RH.
- Spike memakai status SOLANA/BSC VOLUME SPIKE, rasio lonjakan dan baseline 3 jendela 5m sebelumnya. Rasio dan nilai baseline ditampilkan pada dua baris terpisah; kalimat penjelasan "Lonjakan saat event; baseline rata-rata 3 jendela 5m sebelumnya." dihapus dari pesan. Perhitungan baseline tidak berubah. Ini bukan label kandidat baru atau probabilitas profit.
- Milestone memakai 2X/5X TERAMATI, kelipatan aktual saat query dan harga awal deteksi. Bukan target profit atau ATH.

QUALIFIED berarti metadata event menyatakan lolos filter saat deteksi dan metrik wajib pada event masih lengkap, bukan hasil evaluasi ulang dengan config terbaru. Event dari rule lama ditandai HISTORI DETEKSI LAMA, bukan dilabeli rule BSC untuk semua jaringan. Misalnya histori RH lama: `Filter RH terbaru belum terverifikasi`. Jika metadata kandidat baru tidak lengkap, statusnya DATA DETEKSI BELUM LENGKAP.

Event lebih dari 15 menit diberi ALERT TERTUNDA di atas blok data. Harga dan waktu tetap dari snapshot event asli; bot tidak mengganti harga lama dengan hasil query baru hanya agar alert tampak segar.

## Data Kosong dan Aktivitas

Data kosong ditampilkan N/A tanpa simbol mata uang, unit native, atau akhiran menit. Nol yang benar-benar tersedia tetap ditampilkan sebagai nol. Unit fees hanya ditampilkan jika metadata native cocok dengan chain; unit hilang/tidak cocok menghasilkan N/A.

Buy/Sell 1h adalah jumlah transaksi beli/jual pada snapshot, bukan volume USD atau arus smart money. Top 10 adalah persentase kepemilikan supply. Smart Money adalah jumlah holder berlabel provider, bukan bank wallet user. Wallet individual, Flow 5m dan Dex Paid tidak ditampilkan karena sumbernya belum terhubung.

Field aktivitas baru disimpan untuk observasi berikutnya. Snapshot antrean lama yang belum memuat field tersebut mendapat null/N/A; tidak diisi dari snapshot terbaru atau angka perkiraan. Identitas event, timestamp dan harga antrean tidak berubah. Skema tetap versi 3 dengan field tambahan yang kompatibel untuk pembacaan state lama; cadangkan state sebelum upgrade/rollback seperti biasa.

## Tombol

```text
[ GMGN ]       [ Detail Runner ]
[ Salin CA ]
```

GMGN mengikuti jaringan token, bukan bentuk CA saja. Tombol Solscan/BscScan/Explorer dan Refresh dihapus dari notifikasi runner pada semua jaringan. Detail Runner membuka penilaian terkini dan histori chain+CA; Salin CA memakai tombol copy native Telegram dengan CA monospace sebagai cadangan klien lama. Laporan scan biasa tetap mempunyai tombol explorer dan Refresh. Callback pada alert lama tetap didukung agar pesan yang sudah terkirim tidak rusak.

## Mobile dan Desktop

Kedua klien menerima struktur pesan dan keyboard yang sama. Padding label dipadatkan per bagian; baris data yang melebihi 30 karakter dipindah ke baris nilai tersendiri dan dibungkus pada spasi. Baris status yang panjang juga dipisah, termasuk lonjakan/baseline dan harga awal milestone. Angka, unit, CA, dan catatan risiko tidak dipotong untuk mengejar lebar layar. Tanggal dan referensi berada pada baris terpisah. Tidak ada perubahan threshold atau nilai mentah dalam state.

Layout ini mengurangi kebutuhan scroll horizontal untuk angka umum pada mobile; font, skala aksesibilitas dan rendering code block tetap dikendalikan aplikasi Telegram. Tidak ada deteksi perangkat atau CSS khusus pada pesan bot. Nilai numerik tunggal yang ekstrem/panjang masih dapat memerlukan scroll native. Tes mencakup batas kolom pada contoh mobile, bukan screenshot dari perangkat Telegram asli.

Renderer memakai HTML Telegram dengan bold, pre dan code, escape teks provider, dan preview tautan dinonaktifkan. Referensi pendek adalah 12 karakter awal SHA-256 Event ID untuk membantu mengenali duplikat; Event ID lengkap tetap tersimpan pada outbox, tidak diganti sebagai kunci deduplikasi. Kegagalan kirim mempertahankan antrean seperti sebelumnya.

Format berlaku pada alert berikutnya dan event yang belum terkirim setelah upgrade; pesan yang sudah terkirim tidak diubah otomatis. `/runner_test` tetap tes pengiriman biasa, bukan kandidat palsu. Pengujian lokal mencakup renderer dan Telegram API mock; tampilan akhir mengikuti klien Telegram dan perlu diperiksa setelah deploy.

Referensi teknis: [HTML Telegram](https://core.telegram.org/bots/api#html-style). Pengaturan filter: [runner-config.md](runner-config.md).
