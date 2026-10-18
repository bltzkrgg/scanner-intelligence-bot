# Catatan Pengayaan Data GMGN

Status: kebutuhan dicatat, belum seluruhnya diimplementasikan. Parser saat ini mengambil insider dari `token security.suspected_insider_hold_rate` jika tersedia; bundler/sniper exposure supply, developer rug rate, smart-money net flow 1h dan persentase LP terkunci masih `null`.

| Kebutuhan | Sumber yang perlu diverifikasi | Batasan implementasi |
| --- | --- | --- |
| Insider holdings | `token security`, holder berlabel `rat_trader` | Bedakan label dugaan provider dari identitas insider yang terbukti |
| Bundler/sniper exposure | `token holders` dengan label `bundler` / `sniper` | Hitung kepemilikan supply, bukan rasio volume atau jumlah wallet; hindari double-count antar label |
| Riwayat rug developer | `token created-tokens`, identitas developer, histori token dan likuiditas | Definisikan rug secara eksplisit; laporkan sampel/cakupan, jangan mengubah rug ratio token menjadi rug rate developer |
| Smart money flow 1h | Aktivitas wallet/trade bertimestamp dari provider | Hitung buy/sell USD hanya pada rolling 1h; cumulative netflow bukan flow 1h, transfer bukan otomatis pembelian |
| Likuiditas terkunci | `token security.lock_summary` jika tersedia | Verifikasi nominal, denominator LP/pool, expiry, dan cakupan sebelum menerbitkan persen |

Query holders/created-tokens bisa dibatasi (misalnya 100 hasil): sampel tidak boleh disebut seluruh holder atau seluruh histori developer. Dukungan label/field perlu diuji terpisah pada Solana, BSC dan RH serta API key yang digunakan. Ketidaktersediaan harus dibedakan antara "belum diambil bot", "provider tidak menyediakan", "request gagal", dan "sampel parsial".

Sebelum aktivasi: simpan bukti respons provider yang sudah disanitasi, tambahkan test unit/unit-konversi dan rate-limit, tampilkan sumber/waktu/cakupan, lalu baru gunakan metrik dalam skor. Jangan menjanjikan semua data selalu tersedia hanya karena ditampilkan pada UI GMGN. Pengayaan ini tidak otomatis mengaktifkan bank smart wallet user.

Referensi: [GMGN token skill resmi](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md), [GMGN wallet skill resmi](https://github.com/GMGNAI/gmgn-skills/tree/main/skills/gmgn-wallet). Pengaturan alert yang sudah tersedia dijelaskan di [runner-config.md](runner-config.md).
