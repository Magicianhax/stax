CREATE TABLE "gifts" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"from_user_id" text NOT NULL,
	"from_address" text NOT NULL,
	"recipient_email_hash" text NOT NULL,
	"recipient_salt" text NOT NULL,
	"recipient_email_masked" text NOT NULL,
	"basket_id" text,
	"basket_name" text NOT NULL,
	"amount_usd" numeric NOT NULL,
	"note" text,
	"unlock_at" timestamp with time zone NOT NULL,
	"reclaim_after" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"create_tx_hash" text,
	"claim_tx_hash" text,
	"claimed_by_user_id" text,
	"tokens" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gifts_chain_check" CHECK ("gifts"."chain" in ('base', 'mantle')),
	CONSTRAINT "gifts_status_check" CHECK ("gifts"."status" in ('pending', 'funded', 'claimed', 'reclaimed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gifts_chain_recipient_email_hash_idx" ON "gifts" USING btree ("chain","recipient_email_hash");--> statement-breakpoint
CREATE INDEX "gifts_chain_from_user_id_idx" ON "gifts" USING btree ("chain","from_user_id");