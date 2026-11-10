-- §8: books from other branches (FR-REQ-01 to FR-REQ-14).
CREATE TYPE "public"."request_status" AS ENUM('requested', 'accepted', 'in_transit', 'held', 'issued', 'returning', 'completed', 'declined', 'cancelled', 'lapsed', 'lost_in_transit');--> statement-breakpoint
CREATE TABLE "book_request" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "book_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title_id" integer NOT NULL,
	"copy_id" integer,
	"user_id" integer NOT NULL,
	"from_branch_id" integer NOT NULL,
	"to_branch_id" integer NOT NULL,
	"status" "request_status" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"dispatched_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"hold_until" date,
	"borrow_id" integer,
	"lapsed_at" timestamp with time zone,
	"return_dispatched_at" timestamp with time zone,
	"return_arrived_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_request_branches" CHECK ("book_request"."from_branch_id" <> "book_request"."to_branch_id"),
	CONSTRAINT "book_request_steps" CHECK (CASE "book_request"."status"
        WHEN 'requested' THEN "book_request"."copy_id" IS NULL AND "book_request"."decided_at" IS NULL
        WHEN 'declined' THEN "book_request"."copy_id" IS NULL AND "book_request"."decided_at" IS NOT NULL
          AND "book_request"."decided_by" IS NOT NULL AND "book_request"."decline_reason" IS NOT NULL
        WHEN 'cancelled' THEN "book_request"."cancelled_at" IS NOT NULL
        WHEN 'accepted' THEN "book_request"."copy_id" IS NOT NULL AND "book_request"."decided_at" IS NOT NULL
          AND "book_request"."decided_by" IS NOT NULL AND "book_request"."dispatched_at" IS NULL
        WHEN 'in_transit' THEN "book_request"."copy_id" IS NOT NULL AND "book_request"."dispatched_at" IS NOT NULL
          AND "book_request"."arrived_at" IS NULL
        WHEN 'held' THEN "book_request"."arrived_at" IS NOT NULL AND "book_request"."hold_until" IS NOT NULL
          AND "book_request"."borrow_id" IS NULL
        WHEN 'issued' THEN "book_request"."borrow_id" IS NOT NULL
        WHEN 'lapsed' THEN "book_request"."lapsed_at" IS NOT NULL AND "book_request"."borrow_id" IS NULL
          AND "book_request"."return_dispatched_at" IS NULL
        WHEN 'returning' THEN "book_request"."copy_id" IS NOT NULL AND "book_request"."return_arrived_at" IS NULL
        WHEN 'completed' THEN "book_request"."return_arrived_at" IS NOT NULL
        WHEN 'lost_in_transit' THEN "book_request"."copy_id" IS NOT NULL AND "book_request"."lost_reason" IS NOT NULL
      END)
);
--> statement-breakpoint
ALTER TABLE "branch_setting" DROP CONSTRAINT "branch_setting_positive";--> statement-breakpoint
ALTER TABLE "branch_setting" ADD COLUMN "transit_alert_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_copy_id_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_from_branch_id_branch_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_to_branch_id_branch_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request" ADD CONSTRAINT "book_request_borrow_id_borrow_id_fk" FOREIGN KEY ("borrow_id") REFERENCES "public"."borrow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_request_one_open_per_member" ON "book_request" USING btree ("user_id") WHERE "book_request"."status" IN ('requested', 'accepted', 'in_transit', 'held');--> statement-breakpoint
CREATE UNIQUE INDEX "book_request_one_per_copy" ON "book_request" USING btree ("copy_id") WHERE "book_request"."status" IN ('accepted', 'in_transit', 'held', 'lapsed', 'returning');--> statement-breakpoint
CREATE UNIQUE INDEX "book_request_borrow_unique" ON "book_request" USING btree ("borrow_id");--> statement-breakpoint
CREATE INDEX "book_request_from_idx" ON "book_request" USING btree ("from_branch_id","status");--> statement-breakpoint
CREATE INDEX "book_request_to_idx" ON "book_request" USING btree ("to_branch_id","status");--> statement-breakpoint
ALTER TABLE "branch_setting" ADD CONSTRAINT "branch_setting_positive" CHECK ("branch_setting"."loan_days" > 0 AND "branch_setting"."max_books" > 0 AND "branch_setting"."max_books_while_settling" >= 0
        AND "branch_setting"."max_books_while_settling" <= "branch_setting"."max_books" AND "branch_setting"."settlement_window_days" > 0
        AND "branch_setting"."staff_due_warning_days" >= 0 AND "branch_setting"."member_due_warning_days" >= 0
        AND "branch_setting"."decline_grace_days" >= 0 AND "branch_setting"."hold_days" > 0 AND "branch_setting"."transit_alert_days" > 0 AND "branch_setting"."application_stale_days" > 0
        AND "branch_setting"."application_anonymise_days" > 0 AND "branch_setting"."renewal_grace_days" >= 0
        AND "branch_setting"."frequent_late_count" > 0 AND "branch_setting"."frequent_late_months" > 0
        AND "branch_setting"."log_retention_months" >= 24);--> statement-breakpoint
-- FR-REQ-08, R2: a copy set apart for a request is held (waiting for its
-- member) or in transit (chosen and not yet sent, on the road, lapsed and
-- waiting to go back, or returning) — never on the shelf, at either branch.
-- Still worked out, never stored. An open loan comes first: an issued request's
-- copy is on loan like any other.
CREATE OR REPLACE VIEW copy_availability AS
SELECT
  c.id AS copy_id,
  CASE
    WHEN c.withdrawn_at IS NOT NULL THEN 'withdrawn'
    WHEN c.condition = 'missing' THEN 'missing'
    WHEN c.condition = 'not_useable' THEN 'not_useable'
    WHEN b.id IS NOT NULL THEN 'on_loan'
    WHEN r.status = 'held' THEN 'held'
    WHEN r.id IS NOT NULL THEN 'in_transit'
    ELSE 'on_shelf'
  END AS state,
  b.id AS open_borrow_id,
  r.id AS open_request_id
FROM copy c
LEFT JOIN borrow b
  ON b.copy_id = c.id AND b.returned_on IS NULL AND b.voided_at IS NULL
LEFT JOIN book_request r
  ON r.copy_id = c.id AND r.status IN ('accepted', 'in_transit', 'held', 'lapsed', 'returning');
