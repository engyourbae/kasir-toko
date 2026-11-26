-- ============================================================================
-- RLS untuk Kasir Daeng.  BELUM DIJALANKAN -- jalankan manual di Supabase > SQL Editor.
-- Aman & tidak menghapus data (hanya mengatur hak akses). Asumsi: tabel public.kasir_data
-- punya kolom user_id (uuid, unik/primary key) + inventory, debts, history, updated_at.
--
-- LANGKAH 0 (WAJIB, hanya baca): lihat dulu policy yang sudah ada.
--   select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'kasir_data';
-- Policy lama yang longgar (mis. using (true)) HARUS dihapus, karena policy digabung dengan OR.
-- Dampak: setelah ini, pengguna hanya bisa akses barisnya sendiri; mode Guest tidak memakai cloud, jadi tidak terpengaruh.
-- ============================================================================

alter table public.kasir_data enable row level security;
alter table public.kasir_data force row level security;

revoke all on public.kasir_data from anon;
grant select, insert, update, delete on public.kasir_data to authenticated;

drop policy if exists kasir_data_select_own on public.kasir_data;
drop policy if exists kasir_data_insert_own on public.kasir_data;
drop policy if exists kasir_data_update_own on public.kasir_data;
drop policy if exists kasir_data_delete_own on public.kasir_data;

create policy kasir_data_select_own on public.kasir_data for select to authenticated
  using ((select auth.uid()) = user_id);
create policy kasir_data_insert_own on public.kasir_data for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy kasir_data_update_own on public.kasir_data for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy kasir_data_delete_own on public.kasir_data for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Storage bucket "avatars": baca publik (bucket public), tulis hanya file milik sendiri
-- (aplikasi memakai nama file "<user_id>_profile.jpg").
-- ---------------------------------------------------------------------------
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_select_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '_profile.jpg');
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '_profile.jpg')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '_profile.jpg');
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '_profile.jpg');
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '_profile.jpg');

-- Untuk realtime: pastikan tabel ada di publication supabase_realtime (jika belum):
--   alter publication supabase_realtime add table public.kasir_data;
