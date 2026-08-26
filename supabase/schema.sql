create extension if not exists pgcrypto;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'guest')),
  created_at timestamptz not null default now()
);

create table if not exists public.live_sessions (
  id text primary key,
  topic text not null,
  location text not null default '',
  started_at_text text not null,
  live_duration_text text not null default '',
  avg_watch_text text not null default '',
  viewers integer not null default 0,
  views integer not null default 0,
  peak_online integer not null default 0,
  avg_watch_sec integer not null default 0,
  live_duration_sec integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  follows integer not null default 0,
  heat integer not null default 0,
  gift_users integer not null default 0,
  gift_times integer not null default 0,
  gmv numeric not null default 0,
  orders integer not null default 0,
  buyers integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audience_profiles (
  id uuid primary key default gen_random_uuid(),
  live_id text not null unique references public.live_sessions(id) on delete cascade,
  image_count integer not null default 0,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('overview', 'single')),
  live_id text references public.live_sessions(id) on delete cascade,
  dataset_signature text not null default '',
  review jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope, live_id)
);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

alter table public.user_roles enable row level security;
alter table public.live_sessions enable row level security;
alter table public.audience_profiles enable row level security;
alter table public.ai_reviews enable row level security;

drop policy if exists "roles_select_own" on public.user_roles;
drop policy if exists "roles_admin_all" on public.user_roles;
drop policy if exists "lives_select_signed_in" on public.live_sessions;
drop policy if exists "lives_admin_write" on public.live_sessions;
drop policy if exists "profiles_select_signed_in" on public.audience_profiles;
drop policy if exists "profiles_admin_write" on public.audience_profiles;
drop policy if exists "reviews_select_signed_in" on public.ai_reviews;
drop policy if exists "reviews_admin_write" on public.ai_reviews;

create policy "roles_select_own"
  on public.user_roles for select
  using (auth.uid() = user_id or public.is_admin());

create policy "roles_admin_all"
  on public.user_roles for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "lives_select_signed_in"
  on public.live_sessions for select
  using (auth.role() = 'authenticated');

create policy "lives_admin_write"
  on public.live_sessions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "profiles_select_signed_in"
  on public.audience_profiles for select
  using (auth.role() = 'authenticated');

create policy "profiles_admin_write"
  on public.audience_profiles for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "reviews_select_signed_in"
  on public.ai_reviews for select
  using (auth.role() = 'authenticated');

create policy "reviews_admin_write"
  on public.ai_reviews for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.live_sessions (
  id, topic, location, started_at_text, live_duration_text, avg_watch_text,
  viewers, views, peak_online, avg_watch_sec, live_duration_sec, likes, comments,
  shares, follows, heat, gift_users, gift_times, gmv, orders, buyers
) values
('2026-08-16-1815-shencheng', '申城之光——宋思衡原创音乐分享会', '', '2026年08月16日 18:15', '49分钟39秒', '58秒', 2538, 3024, 103, 58, 2979, 35648, 21, 94, 104, 0, 0, 0, 99, 1, 1),
('2026-08-14-1817-songhua', '松花江畔的乐声', '', '2026年08月14日 18:17', '52分钟31秒', '49秒', 2145, 2490, 95, 49, 3151, 34066, 13, 83, 6, 0, 0, 0, 0, 0, 0),
('2026-08-12-1928-musical', '“见证一部音乐剧的诞生”分享会', '', '2026年08月12日 19:28', '1小时0分钟14秒', '4分钟8秒', 435, 719, 46, 248, 3614, 29849, 9, 77, 16, 0, 0, 0, 132.6, 2, 2),
('2026-08-12-1456-bookfair', '书展展台销售直播', '', '2026年08月12日 14:56', '57分钟45秒', '21秒', 903, 1013, 94, 21, 3465, 3459, 1, 23, 1, 0, 0, 0, 0, 0, 0),
('2026-07-09-1900-qiyin', '启音心声，循律而行', '', '2026年07月09日 19:00', '1小时39分钟58秒', '3分钟6秒', 787, 1107, 35, 186, 5998, 58140, 74, 86, 21, 0, 0, 0, 390, 5, 5)
on conflict (id) do update set
  topic = excluded.topic,
  location = excluded.location,
  started_at_text = excluded.started_at_text,
  live_duration_text = excluded.live_duration_text,
  avg_watch_text = excluded.avg_watch_text,
  viewers = excluded.viewers,
  views = excluded.views,
  peak_online = excluded.peak_online,
  avg_watch_sec = excluded.avg_watch_sec,
  live_duration_sec = excluded.live_duration_sec,
  likes = excluded.likes,
  comments = excluded.comments,
  shares = excluded.shares,
  follows = excluded.follows,
  heat = excluded.heat,
  gift_users = excluded.gift_users,
  gift_times = excluded.gift_times,
  gmv = excluded.gmv,
  orders = excluded.orders,
  buyers = excluded.buyers,
  updated_at = now();

create index if not exists audience_profiles_live_idx on public.audience_profiles(live_id);
create index if not exists ai_reviews_scope_live_idx on public.ai_reviews(scope, live_id);

-- After creating the two Supabase Auth users, run these two lines with real IDs:
-- insert into public.user_roles (user_id, role) values ('ADMIN_USER_UUID', 'admin') on conflict (user_id) do update set role = excluded.role;
-- insert into public.user_roles (user_id, role) values ('GUEST_USER_UUID', 'guest') on conflict (user_id) do update set role = excluded.role;
