# Laporan Audit Kasir Daeng v4.25

Arsitektur: situs statis (HTML/CSS/JS) + Supabase (Auth Google, tabel `kasir_data`, bucket `avatars`). Tidak ada backend, jadi tidak ada SQL injection di kode; yang menentukan keamanan data adalah **RLS di Supabase**.

## Diperbaiki (file : alasan)
| File | Perbaikan |
|---|---|
| js/main.js | **XSS tersimpan**: nama barang, satuan, nama pelanggan/piutang, nama toko, isi riwayat & struk sebelumnya masuk `innerHTML` mentah (juga lewat data cloud/CSV). Sekarang di-escape; argumen `onclick` memakai `jsArg()` |
| js/main.js | `eval()` di kalkulator diganti parser aman (`safeCalc`) |
| js/main.js | Data dari cloud/realtime divalidasi harus array; upload foto dibatasi tipe & 8 MB |
| js/main.js | CSV: anti formula-injection Excel, ID NaN, baris `\r\n`, batas 2 MB, harga tidak negatif |
| js/main.js | URL & key Supabase dipindah ke js/config.js; kunci auth lokal dihitung dari URL |
| index.html | Tambah Content-Security-Policy & referrer policy; `rel="noopener noreferrer"` pada link luar; hapus crypto-js (tidak dipakai); path baru |
| sw.js, manifest.json | Path & versi disamakan (sebelumnya sw 4.24, main 4.20, manifest 4.23, tidak sinkron) |
| assets/icons | icon-192 sebenarnya 1024x1536 (2,5 MB, tidak persegi) -> 192x192 (75 KB); icon-512 -> 512x512 |
| .gitignore, .env.example, scripts/build-config.js, .github/workflows/deploy.yml | Baru: key Supabase dari `.env` / GitHub Secrets, `js/config.js` dihasilkan saat build (tidak di-commit) |
| supabase/rls_policies.sql | Baru, **belum dijalankan** (lihat di bawah) |

## Pengujian yang benar-benar dijalankan
- `node --check` pada semua JS: lulus.
- 22 uji unit pada `escHtml`, `jsArg`, `safeItemsHtml`, `highlightName`, `safeCalc` (payload XSS, ekspresi valid/tidak valid): 22 lulus.
- Cek manual semua path file di index.html, sw.js, manifest.

**Belum diuji** (tidak bisa dari sini): login Google, sinkron Supabase, realtime, service worker di browser, suara. Mohon dicoba di HP setelah deploy.

## Risiko tersisa
1. **RLS belum terverifikasi** - saya tidak punya akses ke Supabase Anda. Tanpa RLS yang benar, siapa pun yang memegang anon key (publik) bisa membaca/ubah data semua pengguna. Ini prioritas #1: cek `pg_policies`, lalu jalankan `supabase/rls_policies.sql`. Dampak: policy longgar lama dicabut; data tidak dihapus.
2. CSP masih memakai `'unsafe-inline'` karena aplikasi banyak memakai `onclick=` dan `style=` inline; menghapusnya butuh refactor besar.
3. Library Supabase dimuat dari CDN dengan versi `@2` (tidak dipin, tanpa SRI). Idealnya dipin ke versi tertentu + hash SRI, atau di-host sendiri.
4. Sinkron cloud memakai "last write wins" (tulis seluruh inventory/debts/history); dua perangkat yang edit bersamaan bisa saling menimpa. Perlu perubahan desain, tidak diubah.
5. Data lokal (localStorage) tidak terenkripsi; siapa pun yang memakai HP tersebut bisa membacanya.
6. Backup: gunakan fitur Export CSV (hanya barang) dan backup Supabase (Dashboard > Database > Backups; otomatis harian hanya di paket Pro). Riwayat transaksi & piutang belum punya ekspor sendiri.
7. Tidak ada rate limiting/CORS custom: ditangani Supabase; pastikan batasan signup/auth di dashboard.
