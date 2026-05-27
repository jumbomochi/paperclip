CREATE TABLE IF NOT EXISTS "research_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
