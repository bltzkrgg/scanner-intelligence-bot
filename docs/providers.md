# Provider Scan CA dan Runner

Scan CA, refresh, API `/scan`, dan polling runner memakai adapter gabungan yang sama. Semua enrichment bersifat read-only. Tidak meminta seed phrase/private key dan tidak mengeksekusi transaksi.

## Instalasi dan Konfigurasi

Update repository dan dependency, lalu tambahkan key ke `.env` di server. Jangan kirim key ke chat atau commit `.env`.

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
```

```dotenv
GMGN_PROVIDER=cli
GMGN_API_KEY=
GMGN_HOLDER_ANALYSIS_ENABLED=true
SOLANA_TRACKER_API_KEY=
HELIUS_API_KEY=
MADEONSOL_API_KEY=
MADEONSOL_ENABLED=true
FOMO_API_KEY=
FOMO_ENABLED=true
FOMO_LEADERBOARD_WINDOW=7d
ENRICHMENT_CACHE_SEC=300
```

Key kosong menonaktifkan provider terkait. MadeOnSol dan FOMO juga bisa dimatikan dengan flag ENABLED=false tanpa menghapus key. Default analisis holder GMGN adalah false karena memerlukan query tambahan dan bobot kuota lebih tinggi. Jangan memakai demo/public key untuk menganggap data production sudah diverifikasi. Variabel `*_BASE_URL` dan `FOMO_LEADERBOARD_LIMIT` pada proposal awal tidak dipakai: origin dikunci ke layanan resmi dan limit FOMO tetap 100. Tidak perlu menambahkan variabel tersebut.

`FOMO_LEADERBOARD_WINDOW`: 24h / 7d / 30d / all. `ENRICHMENT_CACHE_SEC`: 30-3600. Key provider yang salah tidak menjatuhkan scan market GMGN; nilai tetap belum tersedia dan alasan kegagalan tersimpan pada diagnostik. GMGN sendiri tetap wajib untuk market dan pemeriksaan keamanan dasar; enrichment bukan fallback market.

```bash
pnpm gmgn:check sol <CA> --discovery
pm2 restart ecosystem.config.cjs --only scanner-telegram --update-env
```

`gmgn:check` sekarang menampilkan snapshot gabungan, sumber yang berhasil dan warning. Tidak mencetak key. Gunakan token Solana nyata; tes API berbayar mengonsumsi kuota. Cadangkan `data/runners.json` sebelum upgrade. Snapshot antrean lama mendapat enrichment null, bukan diisi memakai data terbaru.

### Mengapa Field Masih N/A?

Key terisi hanya mengaktifkan request, bukan menjamin akses/kuota atau data token. Jalankan diagnostik dari direktori repository server:

Diagnostik sekarang membedakan tahap FOMO `leaderboard <window>` dan `token holders`. Error transport membaca kode yang diizinkan dari nested cause/aggregate Node: DNS, TLS, koneksi reset/ditolak, dan timeout. Redirect dilaporkan dengan status 3xx tetapi tidak diikuti; key tidak diteruskan ke host lain. HTTP gagal menampilkan kategori respons HTML/JSON/lain, bukan isi respons. HTML 403 tidak membuktikan masalah paket dan JSON 403 tidak otomatis membuktikan key salah.

Output juga memuat versi Node/platform dan boolean keberadaan konfigurasi proxy/CA tambahan serta flag verifikasi TLS nonaktif. Nilai/path/proxy credential tidak dicetak; `proxyConfigured=true` bukan bukti fetch Node benar-benar memakai proxy tersebut. Jangan menonaktifkan verifikasi TLS atau menghapus filter data untuk memaksa hasil muncul.

HTTP 200 dari `curl .../health` hanya membuktikan endpoint publik tersebut terjangkau pada saat tes dengan curl. Itu tidak menguji autentikasi leaderboard/holder atau trust store/rute koneksi Node. Perbaikan diagnostik ini tidak dengan sendirinya memperbaiki akses provider dan tidak mengisi N/A dengan nilai buatan.

```bash
pnpm providers:check sol <CA>
# atau: pnpm providers:check rh <CA>
```

Output berisi flag aktif/nonaktif, boolean keberadaan key (bukan nilainya), sumber yang berhasil, dan alasan field pada `unavailable`. HTTP 401 dibedakan dari 402 (kredit), 403 (izin/paket/IP), 429 (rate limit), timeout, respons bukan JSON dan format parser tidak cocok. Error parser hanya mencantumkan nama field yang diizinkan, tidak menampilkan nilai mentah. FOMO leaderboard kedaluwarsa atau holder fallback tidak dianggap data live. MadeOnSol memerlukan alamat deployer serta total deploy/bond yang tersedia; key valid saja tidak mengisi data yang belum diindeks.

Wallets dan Linked funding memerlukan `GMGN_HOLDER_ANALYSIS_ENABLED=true`. Tanpa flag ini query holder tidak dijalankan, sekalipun key lain lengkap. Bila GMGN tidak memberikan `native_transfer.from_address` yang valid, Linked funding tetap N/A; metadata funding kosong tidak lagi menggugurkan daftar wallet yang valid. Error teknis enrichment MadeOnSol/FOMO disembunyikan dari pesan Telegram, termasuk salinannya pada bagian Data Belum Tersedia. Alasan tetap tersimpan pada state/API dan `providers:check`. Catatan Risiko pada alert tidak muncul jika tidak ada warning lain; bukti risiko token dan label data parsial tetap tampil. Pesan lama tidak diperbarui otomatis.

Setelah mengubah env, restart lewat `pm2 restart ecosystem.config.cjs --only scanner-telegram --update-env`, bukan hanya mengedit file. CLI check membaca `.env` baru, sementara proses PM2 lama bisa masih memakai env lama. Kirim output diagnostik bila perlu bantuan, jangan `.env`, header auth atau key. Perintah diagnostik tetap membutuhkan GMGN yang berfungsi; flag konfigurasi dicetak sebelum query sehingga tetap bisa diperiksa jika GMGN gagal.

## Pemetaan

| Provider | Integrasi aktif | Jaringan |
| --- | --- | --- |
| GMGN CLI | Market/security, KOL, smart money, Flow 5m jika tersedia; opsional top 100 holder dan kelompok pendanaan | Solana, BSC, RH |
| Solana Tracker | Discovery utama `/search`, DEX pool berlikuiditas terbesar yang segar, creator token, bundler/sniper supply exposure | Solana |
| Helius | RPC `getAccountInfo` jsonParsed, verifikasi mint/freeze authority dan owner program SPL/Token-2022 | Solana |
| MadeOnSol | Solana `/deployer-hunter/{wallet}`: deploy/bond; RH `/rhc/deployer-hunter/{address}` dan `/tokens`: deploy/graduation | Solana, RH |
| FOMO API | Leaderboard 100 trader + top holders token; identitas trader dideduplikasi userId, handle dicocokkan case-insensitive | Solana, BSC, RH jika endpoint menjawab |

Base URL dan auth: GMGN memakai CLI/API key yang sudah ada; Tracker `https://data.solanatracker.io` memakai x-api-key; Helius `https://mainnet.helius-rpc.com` memakai api-key; MadeOnSol `https://madeonsol.com/api/v1` dan FOMO `https://api.fomoapi.io` memakai Bearer. Kunci tidak diteruskan ke domain lain; redirect ditolak.

Harga, volume, market cap dan fee tetap konsisten dari GMGN. DEX yang dilaporkan Tracker adalah metadata pool pilihan Tracker, bukan klaim seluruh angka GMGN adalah khusus pool tersebut. Pool Tracker harus mempunyai timestamp maksimal 15 menit; respons tidak cocok mint ditolak. Authority Helius aktif mempertahankan/memperkuat blok runner, tidak pernah menghapus blok keamanan GMGN.

## Arti Field

- Wallets: persentase supply maksimal lima holder teramati, bukan saldo SOL atau skor wallet.
- Top holder teramati: jumlah persentase supply pada sampel maksimal 100, tidak mengklaim seluruh pemegang. Pool, burn, kontrak token sendiri dan addr_type tidak diketahui dikeluarkan dari daftar wallet normal.
- Linked funding: kelompok dalam sampel yang mempunyai sumber pendanaan native sama. Ini indikasi pendanaan terkait, bukan full bubble map atau bukti satu pemilik. Data funding hilang menghasilkan N/A.
- FOMO: `N trader terdeteksi hold (parsial)` pada window yang dipilih. Top-holder endpoint tidak menjamin seluruh trader terjangkau. Nol terdeteksi bukan bukti tidak ada Top 100 yang hold. Snapshot leaderboard lebih dari 15 menit, fallback/stale holders dan available=false ditolak; normal holder response tidak menjamin timestamp upstream.
- Bonding rate: bonded/deployed; total deploy nol menghasilkan rate N/A, bukan 0%. Statistik dibatasi cakupan MadeOnSol dan bukan win rate.
- Graduation RH: milestone peak market cap $40K menurut MadeOnSol, bukan bonding curve Solana. Scan dan runner menampilkan Graduated/Dev graduated. Bot memvalidasi chain dan alamat developer; bila alamat belum ada dari GMGN, bot mengambil `/rhc/tokens/{CA}`. Jumlah graduated memakai total eksplisit atau halaman token yang lengkap (maksimal 100 token), bukan perkalian persentase yang dibulatkan. Histori lebih panjang/parsial membuat jumlah graduated N/A; graduation_rate eksplisit provider tetap dapat ditampilkan sebagai persen. Daftar `recent_tokens` bukan seluruh histori dan tidak dipakai untuk menghitung rate. Tidak menambah threshold atau skor profit baru.
- Flow 5m: proporsi jumlah transaksi GMGN buys_5m/sells_5m; jika tidak tersedia, tetap Flow 1h dengan label jendela benar. Total nol menghasilkan N/A.
- Field rug history/rate developer dihapus dari tipe, fixture, syarat kelengkapan, laporan dan metrik skor historis. Bobot metrik tersisa dinormalisasi seperti sebelumnya; skor historis lama dan baru tidak identik. Tidak diganti skor bonding yang belum dikalibrasi.

## Cache dan Kegagalan

Cache enrichment default 300 detik per endpoint dibagi oleh scan dan runner dalam satu proses. Discovery Tracker memakai 15 detik, bukan TTL enrichment; RPC authority memakai 30 detik. Request identik yang masih berjalan digabung; refresh eksplisit melewati cache lokal. Query independen Helius/FOMO berjalan bersama jalur Tracker/developer, dengan blok keamanan tetap dipertahankan. Data provider dapat mempunyai cache upstream tersendiri. Setiap query HTTP dibatasi 8 detik, tidak retry tanpa batas. Respons 401/402/403/429 mengaktifkan cooldown 60-3600 detik sesuai Retry-After. Respons invalid/error tidak diubah menjadi nol. Warning tidak menyertakan URL, header auth, atau isi respons error. Cache hanya berlaku per proses, bukan antar proses PM2/API. Lihat [diagnosis latensi runner](runner-latency.md).

## Batasan yang Belum Diimplementasikan

Mengisi semua key tidak berarti semua field lengkap. Posisi likuiditas Meteora, pemeriksaan saldo on-chain wallet FOMO, full transfer cluster/bubble map, LP locked %, Dex Paid dan smart-money USD flow 1h belum tersedia pada implementasi ini. Helius saat ini hanya memverifikasi authority; FOMO hold adalah laporan provider, bukan verifikasi saldo Helius. Histori deployer RH di luar 100 token tidak dipaginasi otomatis; statistik total hanya dipakai jika eksplisit dari provider. ETH belum menjadi jaringan aplikasi yang aktif. Bank smart wallet user dan Discord juga belum diaktifkan oleh integrasi ini.

RH memakai `MADEONSOL_API_KEY` dan `MADEONSOL_ENABLED` yang sama, tanpa variabel env tambahan. Enrichment RH lama dalam state mendapat field graduation null saat dibaca, bukan diisi dari bonding Solana atau data masa depan. Format baru hanya berlaku pada query/pengiriman berikutnya.

Format berikutnya tetap menggunakan tombol GMGN / Detail Runner / Salin CA. Detail risiko scan menampilkan authority, kelompok pendanaan dan cakupan holder; laporan utama dan alert runner menampilkan ringkasan FOMO/KOL/developer bila sumber tersedia. Error teknis MadeOnSol/FOMO tidak ditampilkan di Telegram, sedangkan label parsial dan warning keamanan token tetap ada. Tidak menambahkan probabilitas profit atau kandidat palsu.

Referensi kontrak: [GMGN token](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md), [GMGN holder](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-holder-analysis/SKILL.md), [Tracker token](https://docs.solanatracker.io/data-api/tokens/get-token-information), [Tracker search](https://docs.solanatracker.io/data-api/search/token-search), [Helius RPC](https://www.helius.dev/docs/api-reference/rpc/http/getaccountinfo), [MadeOnSol](https://madeonsol.com/api-docs), [FOMO](https://fomoapi.io/docs).
