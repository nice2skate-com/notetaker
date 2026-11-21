-- Let signed-in devices hear about changes to their own meetings right away
-- (row level security also applies to these notifications).
alter publication supabase_realtime add table public.meetings;
