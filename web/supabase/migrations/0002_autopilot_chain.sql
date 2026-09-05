-- Stax multi-chain: every autopilot (and every run in the audit log) records the
-- chain it executes on.
--
-- Backfill rule: Stax was Mantle-only before this migration, so EVERY pre-existing
-- row belongs to a smart account funded on Mantle and is backfilled to 'mantle'.
-- New rows default to 'base' (the app's DEFAULT_CHAIN_KEY); the API always writes
-- the chain explicitly, so the column default is only a safety net.
-- Safe to re-run: the backfill only touches rows that still carry the transitional
-- NULL (the column is added nullable, backfilled, then made NOT NULL).

-- autopilots -----------------------------------------------------------------
alter table public.autopilots
  add column if not exists chain text;
update public.autopilots set chain = 'mantle' where chain is null;
alter table public.autopilots
  alter column chain set default 'base',
  alter column chain set not null;
alter table public.autopilots
  drop constraint if exists autopilots_chain_check;
alter table public.autopilots
  add constraint autopilots_chain_check check (chain in ('base', 'mantle'));

-- autopilot_runs -------------------------------------------------------------
alter table public.autopilot_runs
  add column if not exists chain text;
update public.autopilot_runs set chain = 'mantle' where chain is null;
alter table public.autopilot_runs
  alter column chain set default 'base',
  alter column chain set not null;
alter table public.autopilot_runs
  drop constraint if exists autopilot_runs_chain_check;
alter table public.autopilot_runs
  add constraint autopilot_runs_chain_check check (chain in ('base', 'mantle'));

-- claim_due_autopilots() returns `a.*`, so the new column flows through to the
-- cron executor unchanged; no function change needed.
