CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_max_uses_check" CHECK ("invite_codes"."max_uses" >= 1),
	CONSTRAINT "invite_codes_uses_check" CHECK ("invite_codes"."uses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "waitlist_events" DROP CONSTRAINT "waitlist_events_action_check";--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "invite_code" text;--> statement-breakpoint
CREATE INDEX "invite_codes_created_at_idx" ON "invite_codes" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "waitlist_events" ADD CONSTRAINT "waitlist_events_action_check" CHECK ("waitlist_events"."action" in ('joined', 'approved', 'blocked', 'unblocked', 'note', 'imported', 'invited'));