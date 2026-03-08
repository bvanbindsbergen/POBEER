CREATE TABLE "strategy_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_name" varchar(255) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"action" varchar(10) NOT NULL,
	"reason" text,
	"strategy_config" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategy_feedback" ADD CONSTRAINT "strategy_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;