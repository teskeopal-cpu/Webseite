CREATE TABLE "quiz_passkey_challenges" (
	"id" text PRIMARY KEY,
	"challenge" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_passkeys" (
	"id" text PRIMARY KEY,
	"public_key" text NOT NULL,
	"counter" bigint NOT NULL,
	"transports" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
