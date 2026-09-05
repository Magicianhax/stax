-- Stax multi-chain: every autopilot (and every run in the audit log) records the
-- chain it executes on. The product default is now Base, so rows written before
-- this migration default to 'base' (matches the app's DEFAULT_CHAIN_KEY). A
-- config only ever runs where its smart account holds USDC — flip individual
-- pre-existing rows to 'mantle' if that user's funded smart account lives there:
--   update public.autopilots set chain = 'mantle' where user_id = '<privy user id>';
-- Safe to re-run (idempotent).

alter table public.autopilots
  add column if not exists chain text not null default 'base';
alter table public.autopilots
  drop constraint if exists autopilots_chain_check;
alter table public.autopilots
  add constraint autopilots_chain_check check (chain in ('base', 'mantle'));

alter table public.autopilot_runs
  add column if not exists chain text not null default 'base';
alter table public.autopilot_runs
  drop constraint if exists autopilot_runs_chain_check;
alter table public.autopilot_runs
  add constraint autopilot_runs_chain_check check (chain in ('base', 'mantle'));

-- claim_due_autopilots() returns `a.*`, so the new column flows through to the
-- cron executor unchanged; no function change needed.
