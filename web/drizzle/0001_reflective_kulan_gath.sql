-- Hand-written (drizzle-kit emitted an invalid `SET DATA TYPE bigserial`). Both tables are
-- empty at this point (created by 0000 minutes earlier), so recreate them with the legacy
-- Supabase-compatible ids: autopilots.id text, autopilot_runs.id bigserial + autopilot_id text.
DROP TABLE "autopilot_runs";--> statement-breakpoint
DROP TABLE "autopilots";--> statement-breakpoint
CREATE TABLE "autopilots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chain" text NOT NULL,
	"wallet_id" text NOT NULL,
	"owner" text NOT NULL,
	"smart_account" text NOT NULL,
	"goal" text NOT NULL,
	"amount_usd" numeric NOT NULL,
	"cadence" text NOT NULL,
	"risk_ceiling_bps" integer NOT NULL,
	"max_per_period_usd" numeric NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"runs" integer DEFAULT 0 NOT NULL,
	"spent_this_period" numeric DEFAULT '0' NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilots_chain_check" CHECK ("autopilots"."chain" in ('base', 'mantle')),
	CONSTRAINT "autopilots_cadence_check" CHECK ("autopilots"."cadence" in ('daily', 'weekly', 'biweekly', 'monthly'))
);
--> statement-breakpoint
CREATE TABLE "autopilot_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"autopilot_id" text,
	"user_id" text NOT NULL,
	"chain" text NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"amount_usd" numeric NOT NULL,
	"assessed_risk_bps" integer,
	"reason" text,
	"tx_hash" text,
	"holdings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_runs_chain_check" CHECK ("autopilot_runs"."chain" in ('base', 'mantle')),
	CONSTRAINT "autopilot_runs_status_check" CHECK ("autopilot_runs"."status" in ('success', 'skipped', 'error'))
);
--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_autopilot_id_autopilots_id_fk" FOREIGN KEY ("autopilot_id") REFERENCES "public"."autopilots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopilots_user_id_key" ON "autopilots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "autopilots_active_next_run_at_idx" ON "autopilots" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "autopilot_runs_user_ran_at_idx" ON "autopilot_runs" USING btree ("user_id","ran_at");
