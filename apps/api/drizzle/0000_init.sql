CREATE TYPE "public"."copy_condition" AS ENUM('useable', 'not_useable', 'missing');--> statement-breakpoint
CREATE TYPE "public"."image_mime" AS ENUM('image/png', 'image/jpeg', 'image/webp');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('fee', 'first_fee', 'waiver', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'suspended', 'rejected', 'deactivated', 'anonymised');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('member', 'admin', 'super_admin');--> statement-breakpoint
CREATE TABLE "accession_counter" (
	"branch_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"next_running" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accession_counter_branch_id_category_code_pk" PRIMARY KEY("branch_id","category_code"),
	CONSTRAINT "accession_counter_range" CHECK ("accession_counter"."next_running" BETWEEN 1 AND 100000)
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"actor_role" text NOT NULL,
	"branch_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before_data" jsonb,
	"after_data" jsonb,
	"ip_address" text,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "activity_log_actor" CHECK ("activity_log"."actor_role" IN ('member', 'admin', 'super_admin', 'system')
        AND (("activity_log"."actor_role" = 'system') = ("activity_log"."actor_id" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_user_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"full_name" text NOT NULL,
	"user_type" "user_type" NOT NULL,
	"status" "user_status" NOT NULL,
	"whatsapp_phone" text,
	"other_phone" text,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"date_of_birth" date,
	"address" text,
	"organisation" text,
	"introduced_by_name" text,
	"introduced_by_phone" text,
	"branch_id" integer,
	"applied_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" integer,
	"identity_checked_by" integer,
	"rejection_reason" text,
	"suspended_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	"expire_at" date,
	"failed_signin_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_whatsapp_phone_unique" UNIQUE("whatsapp_phone"),
	CONSTRAINT "app_user_branch_by_role" CHECK (("app_user"."user_type" = 'super_admin') = ("app_user"."branch_id" IS NULL)),
	CONSTRAINT "app_user_anonymised_has_no_phone" CHECK (("app_user"."status" = 'anonymised') = ("app_user"."whatsapp_phone" IS NULL)),
	CONSTRAINT "app_user_phone_format" CHECK (("app_user"."whatsapp_phone" IS NULL OR "app_user"."whatsapp_phone" ~ '^\+?[0-9]{9,15}$')
        AND ("app_user"."other_phone" IS NULL OR "app_user"."other_phone" ~ '^\+?[0-9]{9,15}$')
        AND ("app_user"."introduced_by_phone" IS NULL OR "app_user"."introduced_by_phone" ~ '^\+?[0-9]{9,15}$')),
	CONSTRAINT "app_user_staff_status" CHECK ("app_user"."user_type" = 'member' OR "app_user"."status" IN ('active', 'deactivated')),
	CONSTRAINT "app_user_rejection_reason" CHECK ("app_user"."status" <> 'rejected' OR "app_user"."rejection_reason" IS NOT NULL),
	CONSTRAINT "app_user_failed_signins" CHECK ("app_user"."failed_signin_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "borrow" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "borrow_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"copy_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"borrow_date" date NOT NULL,
	"due_date" date NOT NULL,
	"original_due_date" date NOT NULL,
	"returned_on" date,
	"issued_by" integer NOT NULL,
	"received_by" integer,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_backdated" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" integer,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrow_dates" CHECK ("borrow"."due_date" > "borrow"."borrow_date" AND "borrow"."original_due_date" > "borrow"."borrow_date"
        AND "borrow"."due_date" >= "borrow"."original_due_date"
        AND ("borrow"."returned_on" IS NULL OR "borrow"."returned_on" >= "borrow"."borrow_date")),
	CONSTRAINT "borrow_received_when_returned" CHECK (("borrow"."returned_on" IS NULL) = ("borrow"."received_by" IS NULL)),
	CONSTRAINT "borrow_void_complete" CHECK (("borrow"."voided_at" IS NULL) = ("borrow"."void_reason" IS NULL)
        AND ("borrow"."voided_at" IS NULL) = ("borrow"."voided_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branch_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"library_name" text NOT NULL,
	"branch_name" text NOT NULL,
	"branch_code" text NOT NULL,
	"logo_image_id" integer,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_branch_code_unique" UNIQUE("branch_code"),
	CONSTRAINT "branch_code_format" CHECK ("branch"."branch_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "branch_phone_format" CHECK ("branch"."phone" ~ '^\+?[0-9]{9,15}$')
);
--> statement-breakpoint
CREATE TABLE "branch_setting" (
	"branch_id" integer PRIMARY KEY NOT NULL,
	"loan_days" integer DEFAULT 14 NOT NULL,
	"max_books" integer DEFAULT 2 NOT NULL,
	"max_books_while_settling" integer DEFAULT 1 NOT NULL,
	"settlement_window_days" integer DEFAULT 100 NOT NULL,
	"staff_due_warning_days" integer DEFAULT 5 NOT NULL,
	"member_due_warning_days" integer DEFAULT 5 NOT NULL,
	"decline_grace_days" integer DEFAULT 3 NOT NULL,
	"hold_days" integer DEFAULT 7 NOT NULL,
	"application_stale_days" integer DEFAULT 30 NOT NULL,
	"application_anonymise_days" integer DEFAULT 90 NOT NULL,
	"renewal_grace_days" integer DEFAULT 90 NOT NULL,
	"frequent_late_count" integer DEFAULT 3 NOT NULL,
	"frequent_late_months" integer DEFAULT 12 NOT NULL,
	"annual_fee_cents" bigint DEFAULT 0 NOT NULL,
	"log_retention_months" integer DEFAULT 24 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_setting_positive" CHECK ("branch_setting"."loan_days" > 0 AND "branch_setting"."max_books" > 0 AND "branch_setting"."max_books_while_settling" >= 0
        AND "branch_setting"."max_books_while_settling" <= "branch_setting"."max_books" AND "branch_setting"."settlement_window_days" > 0
        AND "branch_setting"."staff_due_warning_days" >= 0 AND "branch_setting"."member_due_warning_days" >= 0
        AND "branch_setting"."decline_grace_days" >= 0 AND "branch_setting"."hold_days" > 0 AND "branch_setting"."application_stale_days" > 0
        AND "branch_setting"."application_anonymise_days" > 0 AND "branch_setting"."renewal_grace_days" >= 0
        AND "branch_setting"."frequent_late_count" > 0 AND "branch_setting"."frequent_late_months" > 0
        AND "branch_setting"."log_retention_months" >= 24),
	CONSTRAINT "branch_setting_fee" CHECK ("branch_setting"."annual_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "category" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_code_format" CHECK ("category"."code" ~ '^[A-Z][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "copy" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "copy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"accession_no" text NOT NULL,
	"title_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"accessioned_branch_id" integer NOT NULL,
	"condition" "copy_condition" DEFAULT 'useable' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"price_cents" bigint,
	"source" text,
	"legacy_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_accession_no_unique" UNIQUE("accession_no"),
	CONSTRAINT "copy_accession_format" CHECK ("copy"."accession_no" ~ '^[A-Z]{2}-[A-Z][0-9]-[0-9]{5}$' AND "copy"."accession_no" !~ '-00000$'),
	CONSTRAINT "copy_withdrawn_with_reason" CHECK (("copy"."withdrawn_at" IS NULL) = ("copy"."withdrawn_reason" IS NULL)),
	CONSTRAINT "copy_price" CHECK ("copy"."price_cents" IS NULL OR "copy"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "image" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "image_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"data" "bytea" NOT NULL,
	"thumbnail" "bytea" NOT NULL,
	"mime_type" "image_mime" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_dimensions" CHECK ("image"."width" > 0 AND "image"."height" > 0 AND "image"."bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "membership_payment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "membership_payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"receipt_no" text,
	"collected_by" integer NOT NULL,
	"reason" text,
	"extends_to" date,
	"reverses_payment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_payment_by_kind" CHECK (CASE "membership_payment"."kind"
        WHEN 'fee' THEN "membership_payment"."amount_cents" > 0 AND "membership_payment"."receipt_no" IS NOT NULL
          AND "membership_payment"."extends_to" IS NOT NULL AND "membership_payment"."reverses_payment_id" IS NULL
        WHEN 'first_fee' THEN "membership_payment"."amount_cents" > 0 AND "membership_payment"."receipt_no" IS NOT NULL
          AND "membership_payment"."extends_to" IS NOT NULL AND "membership_payment"."reverses_payment_id" IS NULL
        WHEN 'waiver' THEN "membership_payment"."amount_cents" = 0 AND "membership_payment"."reason" IS NOT NULL
          AND "membership_payment"."extends_to" IS NOT NULL AND "membership_payment"."reverses_payment_id" IS NULL
        WHEN 'reversal' THEN "membership_payment"."amount_cents" <= 0 AND "membership_payment"."reason" IS NOT NULL
          AND "membership_payment"."reverses_payment_id" IS NOT NULL
      END)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "title" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "title_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"writer" text,
	"publisher" text,
	"isbn" text,
	"edition" text,
	"category_code" text NOT NULL,
	"merged_into_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "title_not_blank" CHECK (btrim("title"."title") <> ''),
	CONSTRAINT "title_not_merged_into_self" CHECK ("title"."merged_into_id" IS NULL OR "title"."merged_into_id" <> "title"."id")
);
--> statement-breakpoint
ALTER TABLE "accession_counter" ADD CONSTRAINT "accession_counter_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accession_counter" ADD CONSTRAINT "accession_counter_category_code_category_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."category"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_identity_checked_by_app_user_id_fk" FOREIGN KEY ("identity_checked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_copy_id_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_issued_by_app_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_received_by_app_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_voided_by_app_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_logo_image_id_image_id_fk" FOREIGN KEY ("logo_image_id") REFERENCES "public"."image"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_setting" ADD CONSTRAINT "branch_setting_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy" ADD CONSTRAINT "copy_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy" ADD CONSTRAINT "copy_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy" ADD CONSTRAINT "copy_accessioned_branch_id_branch_id_fk" FOREIGN KEY ("accessioned_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image" ADD CONSTRAINT "image_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_payment" ADD CONSTRAINT "membership_payment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_payment" ADD CONSTRAINT "membership_payment_collected_by_app_user_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_payment" ADD CONSTRAINT "membership_payment_reverses_payment_id_membership_payment_id_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "public"."membership_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title" ADD CONSTRAINT "title_category_code_category_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."category"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title" ADD CONSTRAINT "title_merged_into_id_title_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."title"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "activity_log_branch_idx" ON "activity_log" USING btree ("branch_id","at");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "app_user_branch_idx" ON "app_user" USING btree ("branch_id","user_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "borrow_one_open_loan_per_copy" ON "borrow" USING btree ("copy_id") WHERE "borrow"."returned_on" IS NULL AND "borrow"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "borrow_user_idx" ON "borrow" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "borrow_open_due_idx" ON "borrow" USING btree ("branch_id","due_date") WHERE "borrow"."returned_on" IS NULL AND "borrow"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "copy_title_idx" ON "copy" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "copy_branch_idx" ON "copy" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_payment_reversed_once" ON "membership_payment" USING btree ("reverses_payment_id");--> statement-breakpoint
CREATE INDEX "membership_payment_user_idx" ON "membership_payment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "title_isbn_idx" ON "title" USING btree ("isbn");--> statement-breakpoint
CREATE INDEX "title_category_idx" ON "title" USING btree ("category_code");