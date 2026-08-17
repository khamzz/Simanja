-- =========================================================
-- SIMANJA — Skema Supabase untuk sinkronisasi real-time
-- lintas perangkat & lintas pengguna.
--
-- CARA PAKAI:
-- 1. Buka project Supabase Anda → menu "SQL Editor" → "New query".
-- 2. Tempel SELURUH isi file ini, lalu klik "Run".
-- 3. Isi SUPABASE_URL & SUPABASE_ANON_KEY di js/realtime-sync.js.
-- =========================================================

-- Tabel data penugasan. Kolom "payload" menyimpan seluruh field
-- penugasan (nama, kategori, status, progress, dst) dalam bentuk JSON,
-- supaya skema di sini tidak perlu diubah setiap kali ada field baru
-- di aplikasi.
create table if not exists public.penugasan (
  id bigint primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Tabel akun pengguna (login). password_hash & salt ada DI DALAM payload,
-- password ASLI tidak pernah dikirim/disimpan ke sini (lihat auth.js).
create table if not exists public.app_users (
  id bigint primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Trigger kecil supaya updated_at otomatis terisi setiap kali baris diubah.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_penugasan_updated_at on public.penugasan;
create trigger trg_penugasan_updated_at
  before update on public.penugasan
  for each row execute function public.set_updated_at();

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

-- Aktifkan Row Level Security lalu buat kebijakan akses.
-- CATATAN: kebijakan di bawah ini PUBLIK (siapa pun yang punya anon key bisa
-- baca & tulis) — sengaja dibuat sesederhana mungkin agar cocok dengan
-- arsitektur app ini (tanpa backend/login server). Ini setara dengan
-- disclaimer keamanan yang sudah ada di README: cocok untuk kebutuhan
-- internal skala kecil, BUKAN untuk data sangat rahasia. Untuk keamanan
-- lebih ketat, ganti dengan Supabase Auth + kebijakan berbasis pengguna.
alter table public.penugasan enable row level security;
alter table public.app_users enable row level security;

drop policy if exists "public select penugasan" on public.penugasan;
create policy "public select penugasan" on public.penugasan for select using (true);
drop policy if exists "public insert penugasan" on public.penugasan;
create policy "public insert penugasan" on public.penugasan for insert with check (true);
drop policy if exists "public update penugasan" on public.penugasan;
create policy "public update penugasan" on public.penugasan for update using (true) with check (true);
drop policy if exists "public delete penugasan" on public.penugasan;
create policy "public delete penugasan" on public.penugasan for delete using (true);

drop policy if exists "public select app_users" on public.app_users;
create policy "public select app_users" on public.app_users for select using (true);
drop policy if exists "public insert app_users" on public.app_users;
create policy "public insert app_users" on public.app_users for insert with check (true);
drop policy if exists "public update app_users" on public.app_users;
create policy "public update app_users" on public.app_users for update using (true) with check (true);
drop policy if exists "public delete app_users" on public.app_users;
create policy "public delete app_users" on public.app_users for delete using (true);

-- Aktifkan Realtime (broadcast perubahan) untuk kedua tabel di atas.
-- (Di project Supabase baru, publication "supabase_realtime" sudah ada
-- secara default; blok DO di bawah aman dijalankan berulang kali.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'penugasan'
  ) then
    alter publication supabase_realtime add table public.penugasan;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_users'
  ) then
    alter publication supabase_realtime add table public.app_users;
  end if;
end $$;
