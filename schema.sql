-- 麻雀収支メモ: Supabaseスキーマ
-- プロジェクト "Ryohei Project" (wrvgorwctmdmhznviams) に適用済み。
-- ゼロから別プロジェクトに構築し直す場合はこのファイルをSQL Editorで実行してください。

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '対局記録',
  state jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_sessions_user_id_idx on public.game_sessions(user_id);
create index if not exists game_sessions_user_active_idx
  on public.game_sessions(user_id, active, created_at desc);

alter table public.game_sessions enable row level security;

drop policy if exists "select own sessions" on public.game_sessions;
create policy "select own sessions" on public.game_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "insert own sessions" on public.game_sessions;
create policy "insert own sessions" on public.game_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own sessions" on public.game_sessions;
create policy "update own sessions" on public.game_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own sessions" on public.game_sessions;
create policy "delete own sessions" on public.game_sessions
  for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists game_sessions_set_updated_at on public.game_sessions;
create trigger game_sessions_set_updated_at
  before update on public.game_sessions
  for each row execute function public.set_updated_at();

-- state JSONBの中身の形（アプリ側のJavaScriptで組み立てられる）:
-- {
--   "playerCount": 3,               -- 3 または 4
--   "players": ["", "", "", ""],    -- 表示名（空なら A/B/C/D）
--   "hanchans": [{ "scores": [null, null, null, null] }, ...],
--   "hanchanRate": 1,               -- 1点あたりの円換算レート
--   "chipValue": 100,               -- チップ1枚あたりの点数
--   "chips": [{ "plus": 0, "minus": 0 }, ...],
--   "selfIndex": null               -- players配列内で「自分」に当たるインデックス（0始まり）
-- }

-- いつものメンバー固定の「グループ」。記録（game_sessions）はグループに紐付けられる。
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  player_count int not null default 3,
  players text[] not null default '{}',
  self_index int,
  created_at timestamptz not null default now()
);

create index if not exists groups_user_id_idx on public.groups(user_id);

alter table public.groups enable row level security;

drop policy if exists "select own groups" on public.groups;
create policy "select own groups" on public.groups
  for select using (auth.uid() = user_id);

drop policy if exists "insert own groups" on public.groups;
create policy "insert own groups" on public.groups
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own groups" on public.groups;
create policy "update own groups" on public.groups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own groups" on public.groups;
create policy "delete own groups" on public.groups
  for delete using (auth.uid() = user_id);

alter table public.game_sessions
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists game_sessions_group_id_idx on public.game_sessions(group_id);
