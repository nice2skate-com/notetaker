-- Notetaker: per-user meetings, profile and audio. Everything is private to its owner.

create table public.meetings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null, -- client clock in ms; newest write wins
  deleted boolean not null default false
);
create index meetings_user_id_idx on public.meetings (user_id);
alter table public.meetings enable row level security;
create policy "own meetings: select" on public.meetings for select to authenticated using ((select auth.uid()) = user_id);
create policy "own meetings: insert" on public.meetings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own meetings: update" on public.meetings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own meetings: delete" on public.meetings for delete to authenticated using ((select auth.uid()) = user_id);

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null
);
alter table public.profiles enable row level security;
create policy "own profile: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "own profile: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own profile: update" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Recordings: private bucket, one folder per user: <user id>/<meeting id>/<segment>
insert into storage.buckets (id, name, public) values ('audio', 'audio', false);
create policy "own audio: select" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own audio: insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own audio: update" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own audio: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
