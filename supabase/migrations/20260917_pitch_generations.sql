-- One logical record per pitch-generation request, plus child provider attempts.
--
-- pitch_history intentionally keeps ONE ROW PER CHANNEL (dm, email): the frontend marks each channel
-- sent separately (update-pitch-sent → edit_diff learning) and records outcomes per row
-- (update-outcome). Those rows are deliverables, not generations. They are now linked to their
-- generation through pitch_history.generation_id. Count generations from pitch_generations.
--
-- Safe to re-run.

create table if not exists public.pitch_generations (
  generation_id      uuid primary key,
  status             text not null default 'pending'
                     check (status in ('pending', 'generating', 'success', 'failed')),
  business_name      text,
  fast_mode          boolean not null default false,
  compact            boolean,
  fallback_used      boolean,
  provider_used      text,
  model_used         text,
  attempts_count     integer,
  latency_ms         integer,
  input_tokens       integer,
  output_tokens      integer,
  estimated_cost_usd numeric(12, 6),
  error_code         text,
  error_message      text,
  final_pitch        jsonb,
  request_payload    jsonb,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at       timestamptz
);

create index if not exists pitch_generations_created_at_idx on public.pitch_generations (created_at desc);
create index if not exists pitch_generations_status_idx on public.pitch_generations (status);

create table if not exists public.pitch_generation_attempts (
  id                 bigint generated always as identity primary key,
  generation_id      uuid not null references public.pitch_generations (generation_id) on delete cascade,
  attempt_number     integer not null,
  task               text,
  provider           text not null,
  model              text not null,
  status             text not null check (status in ('success', 'failed', 'skipped')),
  window_ms          integer,
  latency_ms         integer,
  error_code         text,
  error_class        text,
  error_message      text,
  fallback_reason    text,
  input_tokens       integer,
  output_tokens      integer,
  estimated_cost_usd numeric(12, 6),
  started_at         timestamptz,
  completed_at       timestamptz,
  unique (generation_id, attempt_number)
);

create index if not exists pitch_generation_attempts_generation_idx on public.pitch_generation_attempts (generation_id);

alter table public.pitch_history
  add column if not exists generation_id uuid references public.pitch_generations (generation_id) on delete set null;
create index if not exists pitch_history_generation_id_idx on public.pitch_history (generation_id);

-- Server functions use the service role (bypasses RLS). No anon/authenticated access to these tables.
alter table public.pitch_generations enable row level security;
alter table public.pitch_generation_attempts enable row level security;
