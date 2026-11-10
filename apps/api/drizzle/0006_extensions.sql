-- FR-CIR-10 to FR-CIR-13: one extension per loan, requested by the member or granted by staff.
CREATE TYPE "public"."extension_status" AS ENUM('none', 'requested', 'approved', 'declined');--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "extension_status" "extension_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "extension_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "extension_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "extension_decided_by" integer;--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "extension_reason" text;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_extension_decided_by_app_user_id_fk" FOREIGN KEY ("extension_decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "borrow_extension_waiting_idx" ON "borrow" USING btree ("branch_id","due_date") WHERE "borrow"."extension_status" = 'requested' AND "borrow"."returned_on" IS NULL AND "borrow"."voided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_extension" CHECK (CASE "borrow"."extension_status"
        WHEN 'none' THEN "borrow"."extension_requested_at" IS NULL AND "borrow"."extension_decided_at" IS NULL
          AND "borrow"."extension_decided_by" IS NULL AND "borrow"."extension_reason" IS NULL
        WHEN 'requested' THEN "borrow"."extension_requested_at" IS NOT NULL
          AND "borrow"."extension_decided_at" IS NULL AND "borrow"."extension_decided_by" IS NULL
          AND "borrow"."extension_reason" IS NULL
        WHEN 'approved' THEN "borrow"."extension_decided_at" IS NOT NULL
          AND "borrow"."extension_decided_by" IS NOT NULL AND "borrow"."extension_reason" IS NULL
        WHEN 'declined' THEN "borrow"."extension_decided_at" IS NOT NULL
          AND "borrow"."extension_decided_by" IS NOT NULL AND "borrow"."extension_reason" IS NOT NULL
      END);