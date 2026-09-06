CREATE TABLE "autopilot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autopilot_id" uuid,
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
CREATE TABLE "autopilots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
CREATE TABLE "baskets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"owner_user_id" text,
	"name" text NOT NULL,
	"tagline" text,
	"icon" text,
	"items" jsonb NOT NULL,
	"risk_score" integer,
	"author" text,
	"source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baskets_chain_check" CHECK ("baskets"."chain" in ('base', 'mantle'))
);
--> statement-breakpoint
CREATE TABLE "executor_events" (
	"chain" text NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"event" text NOT NULL,
	"plan_id" text,
	"user" text,
	"data" jsonb NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executor_events_chain_tx_hash_log_index_pk" PRIMARY KEY("chain","tx_hash","log_index"),
	CONSTRAINT "executor_events_chain_check" CHECK ("executor_events"."chain" in ('base', 'mantle')),
	CONSTRAINT "executor_events_event_check" CHECK ("executor_events"."event" in ('RecommendationCommitted', 'AllocationExecuted', 'LegFilled'))
);
--> statement-breakpoint
CREATE TABLE "index_cursors" (
	"chain" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_cursors_chain_check" CHECK ("index_cursors"."chain" in ('base', 'mantle'))
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"chain" text NOT NULL,
	"symbol" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"source" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_snapshots_chain_symbol_taken_at_pk" PRIMARY KEY("chain","symbol","taken_at"),
	CONSTRAINT "price_snapshots_chain_check" CHECK ("price_snapshots"."chain" in ('base', 'mantle'))
);
--> statement-breakpoint
CREATE TABLE "smart_accounts" (
	"user_id" text NOT NULL,
	"chain" text NOT NULL,
	"owner" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smart_accounts_user_id_chain_pk" PRIMARY KEY("user_id","chain"),
	CONSTRAINT "smart_accounts_chain_check" CHECK ("smart_accounts"."chain" in ('base', 'mantle'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_autopilot_id_autopilots_id_fk" FOREIGN KEY ("autopilot_id") REFERENCES "public"."autopilots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baskets" ADD CONSTRAINT "baskets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD CONSTRAINT "smart_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_runs_user_ran_at_idx" ON "autopilot_runs" USING btree ("user_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "autopilots_user_id_key" ON "autopilots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "autopilots_active_next_run_at_idx" ON "autopilots" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "baskets_owner_user_id_idx" ON "baskets" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "executor_events_chain_user_idx" ON "executor_events" USING btree ("chain","user");--> statement-breakpoint
CREATE INDEX "executor_events_chain_block_number_idx" ON "executor_events" USING btree ("chain","block_number");--> statement-breakpoint
CREATE INDEX "price_snapshots_chain_symbol_taken_at_idx" ON "price_snapshots" USING btree ("chain","symbol","taken_at" DESC NULLS LAST);