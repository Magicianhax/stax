CREATE TABLE "waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"address" text,
	"email" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"ref_code" text NOT NULL,
	"referred_by" text,
	"source" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	CONSTRAINT "waitlist_status_check" CHECK ("waitlist"."status" in ('waiting', 'approved', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "waitlist_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"waitlist_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_events_action_check" CHECK ("waitlist_events"."action" in ('joined', 'approved', 'blocked', 'unblocked', 'note', 'imported'))
);
--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_events" ADD CONSTRAINT "waitlist_events_waitlist_id_waitlist_id_fk" FOREIGN KEY ("waitlist_id") REFERENCES "public"."waitlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_user_id_key" ON "waitlist" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_address_key" ON "waitlist" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_ref_code_key" ON "waitlist" USING btree ("ref_code");--> statement-breakpoint
CREATE INDEX "waitlist_status_created_at_idx" ON "waitlist" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "waitlist_referred_by_idx" ON "waitlist" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "waitlist_email_lower_idx" ON "waitlist" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "waitlist_events_waitlist_id_idx" ON "waitlist_events" USING btree ("waitlist_id");