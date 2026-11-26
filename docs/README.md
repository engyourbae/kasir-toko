# Kasir Daeng (PWA, offline-first + Supabase)

## Struktur
```
index.html          halaman utama
sw.js, manifest.json  harus tetap di root (scope service worker)
css/                style.css, desktop.css
js/                 main.js, keyboard.js, voice.js (+ config.js hasil build dari .env)
scripts/            build-config.js (.env -> js/config.js)
.github/workflows/  deploy.yml (deploy GitHub Pages dengan Secrets)
assets/icons/       icon-192.png, icon-512.png (sudah dibuat persegi & dikecilkan)
supabase/           rls_policies.sql (jalankan manual setelah dicek)
docs/               README.md, LAPORAN_AUDIT.md
```

## Menjalankan lokal
1. Salin `.env.example` menjadi `.env`, isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` (anon, bukan service_role).
2. `node scripts/build-config.js` (membuat `js/config.js`, sudah di-.gitignore).
3. `python3 -m http.server 8000` lalu buka `http://localhost:8000`.

## Deploy (GitHub Pages)
1. Push ke GitHub (`.env` dan `js/config.js` tidak ikut karena di-.gitignore).
2. Repo > Settings > Secrets and variables > Actions: tambah `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.
3. Settings > Pages > Source: **GitHub Actions**. Setiap push ke `main` otomatis build + deploy.
4. Supabase > Authentication > URL Configuration: tambahkan URL situs ke Site URL & Redirect URLs.
5. Pastikan RLS aktif (`supabase/rls_policies.sql`).

Catatan: anon key tetap terlihat di browser (F12) karena memang dipakai browser; yang disembunyikan hanya dari repo. Keamanan data tetap bergantung pada RLS.

## Update versi
Naikkan angka yang sama di 3 tempat: `CACHE_NAME` + daftar `?v=` di `sw.js`, `?v=` di `index.html`, `APP_VERSION` di `js/main.js`.

## Upload ke GitHub tanpa membocorkan rahasia
- Key hanya ada di `.env` / GitHub Secrets. Jangan pernah mengunggah `.env` lewat drag-and-drop web GitHub (itu mengabaikan .gitignore).
- Jangan pernah commit `service_role` key / password DB. `.gitignore` sudah memblokir `.env*` dan `*.key`.
- Cek sebelum push: `git diff --cached | grep -i "service_role"` harus kosong.
