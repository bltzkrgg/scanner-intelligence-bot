# Catatan Pengayaan Data GMGN

Status: integrasi multi-provider tersedia; lihat [panduan provider](providers.md). Insider berasal dari GMGN jika tersedia. Bundler/sniper memakai jumlah wallet GMGN dan rasio volume bundler berlabel satuan yang sesuai, bukan exposure supply dari Tracker. Smart-money net flow 1h dan persentase LP terkunci belum diimplementasikan dan tetap `null`.

| Kebutuhan | Sumber yang perlu diverifikasi | Batasan implementasi |
| --- | --- | --- |
| Insider holdings | `token security`, holder berlabel `rat_trader` | Bedakan label dugaan provider dari identitas insider yang terbukti |
| Bundler/sniper exposure | `token holders` dengan label `bundler` / `sniper` | Hitung kepemilikan supply, bukan rasio volume atau jumlah wallet; hindari double-count antar label |
| Histori developer | MadeOnSol `/deployer-hunter/{wallet}` | Jumlah deploy dan berhasil bond; bonding rate dihitung dari jumlah, bukan dianggap probabilitas profit |
| Smart money flow 1h | Aktivitas wallet/trade bertimestamp dari provider | Hitung buy/sell USD hanya pada rolling 1h; cumulative netflow bukan flow 1h, transfer bukan otomatis pembelian |
| Likuiditas terkunci | `token security.lock_summary` jika tersedia | Verifikasi nominal, denominator LP/pool, expiry, dan cakupan sebelum menerbitkan persen |

Query holders/created-tokens bisa dibatasi (misalnya 100 hasil): sampel tidak boleh disebut seluruh holder atau seluruh histori developer. Dukungan label/field perlu diuji terpisah pada Solana, BSC dan RH serta API key yang digunakan. Ketidaktersediaan harus dibedakan antara "belum diambil bot", "provider tidak menyediakan", "request gagal", dan "sampel parsial".

Sebelum aktivasi: simpan bukti respons provider yang sudah disanitasi, tambahkan test unit/unit-konversi dan rate-limit, tampilkan sumber/waktu/cakupan, lalu baru gunakan metrik dalam skor. Jangan menjanjikan semua data selalu tersedia hanya karena ditampilkan pada UI GMGN. Pengayaan ini tidak otomatis mengaktifkan bank smart wallet user.

Referensi: [GMGN token skill resmi](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md), [GMGN wallet skill resmi](https://github.com/GMGNAI/gmgn-skills/tree/main/skills/gmgn-wallet). Pengaturan alert yang sudah tersedia dijelaskan di [runner-config.md](runner-config.md).
