CREATE TABLE "deposit_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chain" text NOT NULL,
	"recipient" text NOT NULL,
	"origin_chain_id" integer NOT NULL,
	"origin_currency" text NOT NULL,
	"origin_symbol" text NOT NULL,
	"origin_vm" text NOT NULL,
	"refund_to" text NOT NULL,
	"address" text NOT NULL,
	"request_id" text NOT NULL,
	"fee_usd" numeric NOT NULL,
	"min_usd" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_addresses_chain_check" CHECK ("deposit_addresses"."chain" in ('base', 'mantle')),
	CONSTRAINT "deposit_addresses_origin_vm_check" CHECK ("deposit_addresses"."origin_vm" in ('evm', 'svm', 'tvm', 'bvm'))
);
--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_address_key" ON "deposit_addresses" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_user_route_key" ON "deposit_addresses" USING btree ("user_id","chain","origin_chain_id","origin_currency");