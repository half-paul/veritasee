CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'contributor' NOT NULL,
	"trust_points" integer DEFAULT 0 NOT NULL,
	"byok_provider" text,
	"byok_key_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('reader','contributor','moderator','admin')),
	CONSTRAINT "users_byok_provider_check" CHECK ("users"."byok_provider" is null or "users"."byok_provider" in ('anthropic','openai','gemini','openrouter'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"source_domain" text NOT NULL,
	"current_revision_hash" text,
	"topic_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"revision_hash" text NOT NULL,
	"content" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "correction_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correction_id" uuid NOT NULL,
	"url_or_identifier" text NOT NULL,
	"title" text,
	"author" text,
	"published_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"anchor_text_fragment" text NOT NULL,
	"anchor_prefix" text,
	"anchor_suffix" text,
	"body_md" text NOT NULL,
	"verity_score" integer,
	"rationale" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corrections_status_check" CHECK ("corrections"."status" in ('pending','approved','rejected','withdrawn')),
	CONSTRAINT "corrections_verity_score_check" CHECK ("corrections"."verity_score" is null or ("corrections"."verity_score" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correction_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"scenario" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_scenario_check" CHECK ("ai_runs"."scenario" in ('quick','academic','adversarial'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correction_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_decisions_decision_check" CHECK ("moderation_decisions"."decision" in ('approve','reject','revise'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"correction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "correction_references" ADD CONSTRAINT "correction_references_correction_id_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."corrections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "corrections" ADD CONSTRAINT "corrections_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "corrections" ADD CONSTRAINT "corrections_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "corrections" ADD CONSTRAINT "corrections_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_correction_id_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."corrections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_correction_id_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."corrections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_correction_id_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."corrections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_external_id_key" ON "users" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_source_url_key" ON "articles" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_source_domain_idx" ON "articles" USING btree ("source_domain");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snapshots_article_revision_key" ON "snapshots" USING btree ("article_id","revision_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corrections_article_status_idx" ON "corrections" USING btree ("article_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corrections_author_idx" ON "corrections" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_correction_idx" ON "ai_runs" USING btree ("correction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reputation_events_user_created_idx" ON "reputation_events" USING btree ("user_id","created_at");