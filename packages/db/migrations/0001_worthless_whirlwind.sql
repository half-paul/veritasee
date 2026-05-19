ALTER TABLE "snapshots" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "size_bytes" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN IF EXISTS "content";