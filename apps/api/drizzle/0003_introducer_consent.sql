-- FR-AUT-03: the applicant confirms the person who introduced them agreed to be named.
ALTER TABLE "app_user" ADD COLUMN "introducer_consent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Staff find members at the counter by part of their name.
CREATE INDEX app_user_full_name_trgm_idx ON app_user USING gin (full_name gin_trgm_ops);
