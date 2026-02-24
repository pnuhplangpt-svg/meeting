-- Supabase migration Phase A schema (draft)

create extension if not exists pgcrypto;

-- P3-2: 시간 중복 예약 원천 차단용 EXCLUSION constraint
create extension if not exists btree_gist;

-- P3-5: 슬로우쿼리 모니터링 (Supabase 대시보드 → Reports → Query Performance 에서 확인)
-- Supabase 환경에서는 기본 활성화되어 있으나 명시적으로 선언
create extension if not exists pg_stat_statements;

create table if not exists rooms (
  id text primary key,
  floor text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reservations (
  id text primary key,
  date date not null,
  floor text not null,
  start_time time not null,
  end_time time not null,
  team_name text not null,
  user_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  constraint reservations_time_range_chk check (start_time < end_time),
  constraint reservations_floor_fk foreign key (floor) references rooms(floor)
);

create index if not exists idx_reservations_date_floor_start
  on reservations(date, floor, start_time);

create index if not exists idx_reservations_date_floor_end
  on reservations(date, floor, end_time);

-- P3-2: 같은 층·날짜에서 시간대 중복 예약 원천 차단 (EXCLUSION constraint)
-- tsrange '[)' = 시작 포함, 종료 미포함 (반개구간)으로 연속 예약 허용
alter table reservations
  drop constraint if exists reservations_no_time_overlap;

alter table reservations
  add constraint reservations_no_time_overlap
  exclude using gist (
    floor with =,
    date with =,
    tsrange(
      (date::text || ' ' || start_time::text)::timestamp,
      (date::text || ' ' || end_time::text)::timestamp,
      '[)'
    ) with &&
  );

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  action text not null,
  result text not null,
  actor_type text,
  target_id text,
  memo text
);

create index if not exists idx_audit_logs_ts on audit_logs(ts desc);
create index if not exists idx_audit_logs_action_ts on audit_logs(action, ts desc);

create table if not exists auth_tokens (
  token text primary key,
  token_type text not null,
  subject_id text,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_tokens_expires_at on auth_tokens(expires_at);

-- ------------------------------------------------------------
-- Security hardening: Enable RLS for all public API tables
-- ------------------------------------------------------------
alter table if exists rooms enable row level security;
alter table if exists reservations enable row level security;
alter table if exists audit_logs enable row level security;
alter table if exists auth_tokens enable row level security;

-- Deny by default for anon/authenticated roles.
-- Service role (used by Vercel proxy) bypasses RLS and remains functional.
drop policy if exists rooms_no_access_anon_auth on rooms;
create policy rooms_no_access_anon_auth
  on rooms
  as permissive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists reservations_no_access_anon_auth on reservations;
create policy reservations_no_access_anon_auth
  on reservations
  as permissive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists audit_logs_no_access_anon_auth on audit_logs;
create policy audit_logs_no_access_anon_auth
  on audit_logs
  as permissive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists auth_tokens_no_access_anon_auth on auth_tokens;
create policy auth_tokens_no_access_anon_auth
  on auth_tokens
  as permissive
  for all
  to anon, authenticated
  using (false)
  with check (false);

