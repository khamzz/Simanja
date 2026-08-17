-- =========================================================
-- SIMANJA — supabase-schema-secure.sql
-- "Langkah 3" dari panduan keamanan lanjutan di README.
--
-- JANGAN jalankan file ini sebelum:
--   1. Supabase Auth aktif (Authentication -> Providers -> Email = ON)
--   2. Setiap pengguna sudah punya akun kembar di Supabase Auth
--      (Authentication -> Users) dengan email yang sama persis
--      seperti di tabel app_users
--   3. js/auth-supabase.js sudah diaktifkan (baris <script>-nya di
--      index.html sudah tidak dikomentari lagi) dan sudah dicoba
--      berhasil login di project Supabase PERCOBAAN.
--
-- Kalau tiga syarat di atas belum terpenuhi, menjalankan file ini akan
-- membuat aplikasi TIDAK BISA membaca/menulis data sama sekali untuk
-- SIAPA PUN, karena sistem login lama tidak pernah benar-benar
-- "check-in" ke Supabase Auth.
--
-- Cara pakai: buka SQL Editor di dashboard Supabase project Anda,
-- tempel seluruh isi file ini, lalu klik Run.
-- =========================================================

-- ---------- Tabel: penugasan ----------

drop policy if exists "public select penugasan" on public.penugasan;
create policy "authenticated select penugasan" on public.penugasan
  for select using (auth.role() = 'authenticated');

drop policy if exists "public insert penugasan" on public.penugasan;
create policy "authenticated insert penugasan" on public.penugasan
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "public update penugasan" on public.penugasan;
create policy "authenticated update penugasan" on public.penugasan
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public delete penugasan" on public.penugasan;
create policy "authenticated delete penugasan" on public.penugasan
  for delete using (auth.role() = 'authenticated');

-- ---------- Tabel: app_users ----------

drop policy if exists "public select app_users" on public.app_users;
create policy "authenticated select app_users" on public.app_users
  for select using (auth.role() = 'authenticated');

drop policy if exists "public insert app_users" on public.app_users;
create policy "authenticated insert app_users" on public.app_users
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "public update app_users" on public.app_users;
create policy "authenticated update app_users" on public.app_users
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "public delete app_users" on public.app_users;
create policy "authenticated delete app_users" on public.app_users
  for delete using (auth.role() = 'authenticated');

-- =========================================================
-- Setelah menjalankan ini: siapa pun yang HANYA punya anon key (mis.
-- lewat "View Source" website) tidak lagi bisa membaca/menulis data —
-- mereka harus benar-benar login lewat Supabase Auth dulu (lewat
-- js/auth-supabase.js) supaya auth.role() bernilai 'authenticated'.
--
-- Ingin kontrol lebih halus (mis. pegawai biasa hanya boleh mengubah
-- datanya sendiri, bukan milik pegawai lain)? Policy di atas bisa
-- diperketat lagi memakai auth.uid(), tapi itu perlu penyesuaian skema
-- tambahan (kolom pemilik baris) di luar cakupan file ini.
-- =========================================================
