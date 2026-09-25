ALTER TABLE "autopilot_runs" DROP CONSTRAINT "autopilot_runs_chain_check";--> statement-breakpoint
ALTER TABLE "autopilots" DROP CONSTRAINT "autopilots_chain_check";--> statement-breakpoint
ALTER TABLE "baskets" DROP CONSTRAINT "baskets_chain_check";--> statement-breakpoint
ALTER TABLE "deposit_addresses" DROP CONSTRAINT "deposit_addresses_chain_check";--> statement-breakpoint
ALTER TABLE "executor_events" DROP CONSTRAINT "executor_events_chain_check";--> statement-breakpoint
ALTER TABLE "gifts" DROP CONSTRAINT "gifts_chain_check";--> statement-breakpoint
ALTER TABLE "index_cursors" DROP CONSTRAINT "index_cursors_chain_check";--> statement-breakpoint
ALTER TABLE "price_snapshots" DROP CONSTRAINT "price_snapshots_chain_check";--> statement-breakpoint
ALTER TABLE "smart_accounts" DROP CONSTRAINT "smart_accounts_chain_check";--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_chain_check" CHECK ("autopilot_runs"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_chain_check" CHECK ("autopilots"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "baskets" ADD CONSTRAINT "baskets_chain_check" CHECK ("baskets"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_chain_check" CHECK ("deposit_addresses"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "executor_events" ADD CONSTRAINT "executor_events_chain_check" CHECK ("executor_events"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_chain_check" CHECK ("gifts"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "index_cursors" ADD CONSTRAINT "index_cursors_chain_check" CHECK ("index_cursors"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_chain_check" CHECK ("price_snapshots"."chain" in ('base', 'mantle', 'bsc'));--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD CONSTRAINT "smart_accounts_chain_check" CHECK ("smart_accounts"."chain" in ('base', 'mantle', 'bsc'));