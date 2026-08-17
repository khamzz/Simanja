# SIMANJA — Sistem Pemantauan Penugasan Manajemen Risiko

Aplikasi web untuk memantau dan mengelola data penugasan, hasil migrasi dari
`Dashboard_Pemantauan_Penugasan_2025.xlsx`. Dibangun tanpa framework/build-step (HTML, CSS,
JavaScript murni) sehingga bisa langsung dijalankan di browser atau dihosting gratis lewat
**GitHub Pages**.

## 🚀 Perbaikan performa & UX (terbaru)

- **Logo & favicon dikompres** — `assets/logo-sigma.png` turun dari 79KB menjadi ±10.7KB,
  plus favicon terpisah (`favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`) untuk tab
  browser & shortcut HP.
- **Layar "Memuat SIMANJA…"** tampil saat aplikasi pertama dibuka, otomatis hilang begitu data
  siap (ada jaring pengaman kalau terjadi error).
- **Chip "filter aktif"** di halaman Data Penugasan — tiap filter/pencarian yang aktif bisa
  dihapus satu-satu lewat tombol ×.
- **Kontras teks `--ink-500` diperbaiki** dari rasio 3.75:1 menjadi ~5.9:1, lolos standar
  aksesibilitas WCAG AA.
- **CSS & JS diminifikasi** (`css/style.min.css`, `js/*.min.js`) dan sudah dihubungkan di
  `index.html` — file asli (non-`.min`) tetap disimpan untuk keperluan edit.
- **SheetJS (xlsx) & JSZip dimuat sesuai kebutuhan** (`js/lazy-libs.js`), bukan otomatis di
  awal — mempercepat waktu buka pertama aplikasi.
- **Onboarding singkat** untuk pengguna baru (tombol "?" di topbar untuk membuka lagi
  kapan saja).
- **Menu sidebar dikelompokkan**: Pemantauan / Layanan / Akun / Data.
- **Halaman 404** (`404.html`) bergaya SIMANJA untuk tautan yang salah/rusak di GitHub Pages.

## 🎨 Gaya tampilan: Claymorphism

Seluruh antarmuka memakai gaya **claymorphism** — sudut yang sangat membulat, warna pastel
(indigo–amber), dan bayangan lembut ganda (highlight terang di atas + bayangan lembut di
bawah) sehingga setiap kartu, tombol, dan panel tampak empuk & 3D seperti tanah liat.
Tipografi memakai font rounded **Baloo 2** (judul) dan **Nunito** (isi/data) untuk memperkuat
kesan lembut tersebut. Semua fungsi aplikasi tidak berubah — hanya tampilannya yang
diperbarui.

## Fitur

- **Dashboard**: statistik ringkas, kalender penugasan bulanan, distribusi kategori, sebaran
  bulanan, dan beban per PIC.
- **Kalender Penugasan** (di Dashboard): grid kalender per bulan menampilkan jadwal setiap
  penugasan (tanggal mulai, due date, dan rentang berlangsung) pada setiap harinya. Bisa
  difilter per **kategori** dan **status**, serta dicari berdasarkan nama/nomor ST/PIC — semua
  scoped ke bulan yang sedang ditampilkan. Klik tanggal mana pun untuk melihat daftar lengkap
  penugasan hari itu.
- **Tombol Hamburger** di topbar untuk menyembunyikan/menampilkan sidebar, memaksimalkan ruang
  tampilan konten. Preferensi tersimpan otomatis.
- **CRUD Data Penugasan** *(khusus pengguna yang sudah masuk)*: tambah, ubah, hapus. Tombol
  "Tambah Penugasan" hanya tampil di halaman Dashboard dan Data Penugasan.
- **Progress bar** & **Sistem Persetujuan (Approval/Reject)** *(khusus pengguna yang sudah
  masuk)* — tercatat otomatis atas nama akun yang login.
- **Login** *(pendaftaran akun baru hanya bisa dilakukan oleh Super Admin — lihat di bawah)*:
  masuk dengan Email/Nama Lengkap + Password. Ada opsi **"Ingat saya di perangkat ini"** untuk
  menyimpan username & password di browser agar tidak perlu mengetik ulang setiap kali (lihat
  catatan keamanan). Setelah masuk, tersedia menu **Profil** (lihat/ubah data & password) dan
  **Keluar** — logout akan mengembalikan form Masuk ke kondisi default (kosong, atau terisi
  ulang otomatis jika "Ingat saya" aktif).
- **Impor File (Excel/CSV/JSON)** dan **Reset Semua Data** *(khusus Super Admin)*: kedua menu
  ini di sidebar hanya bisa diakses oleh akun berperan Super Admin. Reset akan mengosongkan
  seluruh data penugasan (0 data) dan memerlukan **verifikasi password akun** sebelum
  dieksekusi.
- **Super Admin — Manajemen Pengguna**: satu-satunya cara membuat akun baru. Super Admin
  punya akses penuh untuk menambah, mengubah, mereset password, dan menghapus akun pengguna
  mana pun (lihat kredensial & peringatan keamanan di bawah).
- **Ekspor/Impor**: data penugasan & data pengguna ke/dari Microsoft Excel (.xlsx), CSV, JSON,
  atau Google Sheets (dengan opsi Auto-Sync).
- **Data awal**: 2 contoh penugasan (PIC `Kgs` & `Khamzz`) tersedia saat pertama kali dibuka, sebagai
  contoh format data. Data lama hasil migrasi Excel (200 baris) sudah dihapus — silakan tambah data
  penugasan Anda sendiri lewat menu **Tambah Penugasan** atau impor file Excel/CSV/JSON.

## 🔑 Akun Super Admin (bawaan)

| Username |
|---|
| `adminkmr` |

Password **tidak lagi tetap/hardcoded**. Sejak versi ini, saat aplikasi pertama kali
dijalankan (localStorage/Supabase masih kosong), akun `adminkmr` dibuat otomatis dengan
**password acak** yang ditampilkan **satu kali saja** lewat sebuah kotak dialog di layar —
segera salin & simpan password itu. Setelah login pertama kali dengan password tersebut,
Anda akan **diwajibkan langsung mengganti password** dengan pilihan Anda sendiri sebelum
bisa melanjutkan.

> Ini menutup celah keamanan versi sebelumnya, di mana username & password bawaan tertulis
> polos di `js/auth.js` dan bisa dibaca siapa pun yang membuka source code publik repo ini.
> Kredensial sekarang tidak pernah tersimpan di kode sumber.
>
> **Jika Anda kehilangan/tidak sempat menyalin password acak tersebut**, hapus data browser
> (localStorage) untuk situs ini — atau, jika Supabase sudah aktif, hapus baris akun
> `adminkmr` di tabel `app_users` lewat dashboard Supabase — lalu muat ulang halaman agar
> akun Super Admin baru (dengan password acak baru) dibuat ulang.

### Fitur keamanan tambahan versi ini
- **Wajib ganti password** setelah login memakai password sementara/acak (berlaku untuk
  akun Super Admin bawaan di atas).
- **Pembatasan percobaan login**: setelah 5 kali gagal berturut-turut dari perangkat yang
  sama, aplikasi mengunci sementara (30 detik, berlipat ganda tiap kegagalan berikutnya,
  maksimum 1 jam) sebelum bisa mencoba lagi. Ini pembatasan sisi-browser (localStorage per
  perangkat) — bukan pengaman sempurna, tapi menaikkan biaya serangan otomatis lewat form
  login biasa.
- **"Ingat saya di perangkat ini" tidak lagi menyimpan password asli.** Yang tersimpan di
  `localStorage` sekarang adalah token acak sekali pakai (bukan password), diverifikasi
  lewat hash tersendiri di data akun — mirip cara password diverifikasi tapi terpisah.
  Login jadi otomatis begitu token cocok. Token ini bisa dicabut kapan saja lewat menu
  **Profil → Lupakan Perangkat Ini**.

> ⚠️ **Keterbatasan yang masih ada** (bawaan arsitektur tanpa server): karena verifikasi
> login tetap terjadi di browser, seluruh daftar akun (termasuk hash password + salt semua
> pengguna) tetap ikut dimuat ke memori browser siapa pun yang membuka situs ini, dan hak
> akses (mis. "Super Admin") tetap bisa dilewati lewat Console browser oleh yang paham
> caranya. Menutup ini sepenuhnya memerlukan autentikasi & otorisasi sungguhan di server —
> lihat bagian **"Langkah Keamanan Lanjutan (opsional)"** di bawah untuk panduan migrasi ke
> Supabase Auth.

## Menambahkan akun pengguna baru

Pendaftaran mandiri (self-registration) publik **sengaja tidak lagi tersedia**. Satu-satunya
cara membuat akun baru adalah lewat Super Admin:

1. Masuk sebagai Super Admin.
2. Buka menu **Manajemen Pengguna** di sidebar.
3. Klik **Tambah Pengguna**, isi Nama Lengkap, NIP, Email, No HP, Password, dan pilih Role
   (`Pegawai` atau `Super Admin`).

Dari halaman yang sama, Super Admin juga bisa **mengubah data**, **mereset password** (tanpa
perlu tahu password lama), dan **menghapus** akun pengguna mana pun — kecuali menghapus akun
yang sedang dipakai untuk login saat itu, atau menghapus Super Admin terakhir yang tersisa.

## "Ingat Saya di Perangkat Ini"

Di halaman Masuk, mencentang **"Ingat saya di perangkat ini"** akan menyimpan **token acak**
(bukan password) ke `localStorage` browser tersebut, lalu otomatis **login sendiri** setiap
kali halaman dibuka kembali di perangkat itu (termasuk setelah logout). Jika kotak ini
**tidak** dicentang saat login, token yang tersimpan sebelumnya (jika ada) akan dihapus.

> **Catatan keamanan**: berbeda dari versi sebelumnya (yang menyimpan password asli/plaintext),
> sekarang yang tersimpan hanyalah token sekali pakai yang tidak bisa dipakai untuk menebak
> password akun. Tetap jangan gunakan fitur ini di perangkat bersama/publik — siapa pun yang
> memakai perangkat itu akan otomatis masuk sebagai akun Anda selama token belum dicabut.
> Cabut token kapan saja lewat menu **Profil → Lupakan Perangkat Ini**, atau dengan tidak
> mencentang kotak ini saat login berikutnya.

## ⚠️ Catatan penting soal keamanan login (berlaku umum)

Aplikasi ini berjalan **100% di browser, tanpa server/backend**. Password akun tidak pernah
disimpan/diekspor dalam bentuk asli (hanya hash SHA-256 + salt), namun skema ini tetap jauh
lebih lemah dibanding sistem login berbasis server sungguhan — cocok untuk kebutuhan internal
skala kecil dengan risiko rendah, bukan untuk data sangat rahasia. Untuk kebutuhan produksi,
kembangkan lebih lanjut dengan backend/API autentikasi sungguhan (mis. Firebase Auth,
Supabase Auth, atau SSO instansi).

## Cara menjalankan di komputer

```bash
python3 -m http.server 8000
# atau
npx serve .
```

Lalu buka `http://localhost:8000`.

## Menjalankan otomatis di GitHub (GitHub Pages)

Repo ini sudah dilengkapi workflow **GitHub Actions**
(`.github/workflows/deploy-pages.yml`) yang otomatis mem-build & mempublikasikan situs ke
**GitHub Pages** setiap kali ada `push` ke branch `main`. Langkahnya:

1. Buat repository baru di GitHub (kosong, tanpa README/gitignore bawaan).
2. Hubungkan & push repo ini (lihat bagian **"Menghubungkan & mempublikasikan ke GitHub"**
   di bawah).
3. Buka **Settings → Pages** pada repo, di bagian **Build and deployment → Source**, pilih
   **GitHub Actions** (bukan "Deploy from a branch").
4. Setelah push pertama selesai, cek tab **Actions** — begitu workflow "Deploy ke GitHub
   Pages" selesai (centang hijau), situs akan otomatis tersedia di
   `https://<username-anda>.github.io/<nama-repo>/`.
5. Setiap kali Anda push perubahan baru ke `main`, situs akan otomatis ter-update tanpa
   langkah manual apa pun.

## Penyimpanan data

Data (penugasan & akun pengguna) tersimpan di **localStorage** browser masing-masing pengguna
sebagai cache, dan otomatis tersinkron real-time lintas perangkat & pengguna jika fitur
**Sinkronisasi Real-time** di bawah ini diaktifkan (direkomendasikan). Alternatif lain (satu arah,
tidak real-time) adalah integrasi Google Sheets.

## ⚡ Sinkronisasi Real-time (multi-perangkat, multi-pengguna)

Sejak versi ini, aplikasi mendukung **database bersama sungguhan** memakai
[Supabase](https://supabase.com) (Postgres + Realtime, gratis untuk skala kecil–menengah).
Begitu diaktifkan, setiap perubahan (tambah/ubah/hapus data penugasan, approval, atau perubahan
akun pengguna) oleh **siapa pun di perangkat mana pun** langsung muncul otomatis di semua
perangkat/pengguna lain dalam hitungan detik — tanpa perlu ekspor/impor manual.

**Cara mengaktifkan (sekali saja, oleh pengelola aplikasi):**

1. Buat project gratis di [supabase.com](https://supabase.com).
2. Buka **SQL Editor** pada project tsb → tempel & jalankan seluruh isi file
   [`supabase-schema.sql`](./supabase-schema.sql) yang sudah disertakan di repo ini.
3. Buka **Project Settings → API**, salin **Project URL** dan **anon public key**.
4. Buka `js/realtime-sync.js`, isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di baris paling atas
   dengan nilai dari langkah 3.
5. Push/unggah ulang perubahan tsb (commit ke `main` bila pakai GitHub Pages).
6. Buka aplikasinya — indikator **"Live"** akan muncul di pojok kanan atas topbar jika berhasil
   terhubung. Semua pengguna yang membuka aplikasi ini otomatis memakai server bersama yang sama.

Jika langkah di atas belum dilakukan, aplikasi tetap berjalan seperti biasa (localStorage
per-browser saja, tanpa sinkronisasi lintas perangkat) — tidak ada yang rusak.

> **⚠️ Catatan keamanan**: sama seperti kredensial Super Admin bawaan (lihat bagian di atas),
> `SUPABASE_ANON_KEY` akan terlihat oleh siapa pun yang membuka source code aplikasi ini, karena
> aplikasi berjalan 100% di browser tanpa server rahasia. Skema `supabase-schema.sql` sengaja
> dibuat mengizinkan baca/tulis publik ke tabel data (cocok untuk kebutuhan internal skala kecil,
> sama seperti disclaimer keamanan login di atas). **Jangan** gunakan untuk data yang sangat
> rahasia/sensitif tanpa memperketat kebijakan RLS-nya terlebih dahulu (mis. menambahkan
> Supabase Auth + kebijakan berbasis pengguna sungguhan).

## 🔒 Langkah Keamanan Lanjutan (opsional, untuk keamanan maksimal)

Perbaikan di versi ini (password acak sekali tampil, wajib ganti password, pembatasan
percobaan login, "ingat saya" berbasis token) menutup celah-celah yang paling gampang
dieksploitasi. Tapi karena aplikasi ini tetap berjalan 100% di browser, ada satu batasan
mendasar yang **hanya bisa ditutup dengan menambahkan server/backend sungguhan**: siapa pun
yang membuka Console browser di situs ini masih bisa membaca variabel `authState.users`
(berisi hash password semua akun) dan, jika Supabase aktif, mengambil `SUPABASE_ANON_KEY`
dari source code untuk membaca/menulis langsung ke database lewat API — karena kebijakan RLS
di `supabase-schema.sql` sengaja dibuat publik (siapa saja boleh baca/tulis) agar aplikasi
tanpa server ini bisa berfungsi sama sekali.

Jika data Anda cukup sensitif (data pegawai sungguhan, bukan sekadar demo/uji coba), langkah
paling berdampak adalah memindahkan verifikasi login ke **Supabase Auth** (gratis untuk skala
kecil) dan mengganti kebijakan RLS supaya **hanya pengguna yang sudah login** (bukan siapa
saja dengan anon key) yang boleh membaca/menulis data. Ini perubahan arsitektur yang lebih
besar — bukan sekadar edit beberapa baris — jadi sengaja **tidak diterapkan otomatis** di
sini; silakan ikuti panduan bertahap berikut jika Anda ingin melakukannya sendiri atau minta
bantuan developer:

1. **Aktifkan Supabase Auth** — di dashboard Supabase project Anda, buka **Authentication →
   Providers**, pastikan **Email** aktif. Ini fitur bawaan Supabase, gratis untuk skala kecil.
2. **Buat akun untuk tiap pengguna di Supabase Auth** (lewat dashboard **Authentication →
   Users → Add user**, atau lewat kode) — ini terpisah dari tabel `app_users` yang sudah ada;
   untuk migrasi penuh, setiap baris di `app_users` idealnya punya pasangan akun di Supabase
   Auth dengan email yang sama.
3. **Aktifkan modul login Supabase Auth yang sudah disiapkan** — buka `index.html`, cari baris
   `<!-- <script src="js/auth-supabase.js"></script> -->` (letaknya tepat setelah
   `<script src="js/auth.js"></script>`), hapus tanda komentarnya. File
   [`js/auth-supabase.js`](./js/auth-supabase.js) sudah berisi kode lengkap untuk memanggil
   `signInWithPassword`, `signOut`, dan memulihkan sesi — baca komentar di bagian atas file
   tsb untuk syarat & urutan pengaktifannya. **Uji dulu langkah ini di project Supabase
   percobaan** (lihat langkah 5) sebelum lanjut ke langkah 4.
4. **Baru setelah langkah 3 terbukti berhasil**, perketat kebijakan RLS supaya anon key saja
   tidak lagi cukup untuk membaca/menulis — pengguna harus benar-benar login dulu. File
   [`supabase-schema-secure.sql`](./supabase-schema-secure.sql) sudah berisi seluruh perintah
   SQL siap-pakai untuk ini (tinggal salin-tempel ke **SQL Editor** Supabase lalu klik **Run**).
   Untuk kontrol lebih halus (misalnya pegawai biasa hanya boleh mengubah datanya sendiri),
   kebijakan bisa diperketat lagi berdasarkan `auth.uid()` — di luar cakupan file ini.
5. **Uji coba menyeluruh** di lingkungan terpisah (project Supabase percobaan yang berbeda dari
   yang sungguhan dipakai pengguna) sebelum mempublikasikan perubahan ini, karena ini mengubah
   alur inti login. Baru setelah yakin semuanya berjalan lancar, terapkan langkah 3 dan 4 yang
   sama ke project Supabase yang sungguhan dipakai.

> ⚠️ **Urutan penting**: aktifkan `js/auth-supabase.js` (langkah 3) dan uji sampai berhasil
> login **sebelum** menjalankan `supabase-schema-secure.sql` (langkah 4). Kalau kebijakan RLS
> diperketat duluan sementara sistem login belum benar-benar memakai Supabase Auth, aplikasi
> akan langsung terkunci — tidak ada yang bisa baca/tulis data sama sekali.

Karena langkah 1–5 di atas memerlukan akses ke project Supabase Anda sendiri dan pengujian
langsung di browser sungguhan, langkah-langkah ini perlu dijalankan oleh Anda (atau developer
yang Anda percaya) secara langsung — bukan sesuatu yang bisa diterapkan dari luar tanpa akses
ke akun Supabase dan repo GitHub Anda.


## Menghubungkan ke Google Sheets (database bersama)

1. [Google Cloud Console](https://console.cloud.google.com/) → aktifkan **Google Sheets API**.
2. **APIs & Services → Credentials** → buat **OAuth Client ID** tipe *Web application*, tambah
   ke **Authorized JavaScript origins**: `http://localhost:8000` dan/atau
   `https://<username-anda>.github.io`.
3. Salin **Client ID** & **Spreadsheet ID** (dari URL spreadsheet, antara `/d/` dan `/edit`).
4. Menu **Integrasi Data** → isi Client ID, Spreadsheet ID, nama tab data penugasan (`Data`)
   & data pengguna (`Users`) → simpan → **Hubungkan Akun Google**.
5. Gunakan tombol ekspor/impor, atau aktifkan **Auto-Sync**.

## Menghubungkan & mempublikasikan ke GitHub

```bash
git remote add origin https://github.com/<username-anda>/<nama-repo>.git
git branch -M main
git push -u origin main
```

Aktifkan **GitHub Pages** di **Settings → Pages** (branch `main`, folder root). Jika memakai
Google Sheets, tambahkan URL GitHub Pages ke **Authorized JavaScript origins** OAuth Client ID.

> Karena repo bisa jadi publik, ingat kembali: file `js/auth.js` (termasuk kredensial Super
> Admin bawaan) akan ikut terlihat publik. Ganti password default sebelum/ segera setelah
> publikasi.

## Struktur proyek

```
pemantauan-app/
├── index.html             # Halaman utama
├── css/style.css           # Seluruh styling
├── js/app.js                # CRUD, filter, dashboard, kalender, approval, ekspor/impor
├── js/auth.js                # Registrasi, login, sesi, profil, Super Admin & manajemen pengguna
├── js/seed-data.js          # Data awal (hasil migrasi dari Excel)
└── README.md
```
