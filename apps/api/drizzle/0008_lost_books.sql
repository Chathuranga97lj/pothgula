CREATE TYPE "public"."loss_kind" AS ENUM('lost', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."settlement_payment_kind" AS ENUM('payment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('open', 'replaced', 'paid', 'waived', 'found');--> statement-breakpoint
CREATE TABLE "book_settlement" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "book_settlement_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"borrow_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"copy_branch_id" integer NOT NULL,
	"kind" "loss_kind" NOT NULL,
	"reason" text NOT NULL,
	"declared_on" date NOT NULL,
	"declared_by" integer NOT NULL,
	"tariff_cents" bigint,
	"set_amount_cents" bigint NOT NULL,
	"amount_reason" text,
	"amount_set_by" integer NOT NULL,
	"amount_due_cents" bigint NOT NULL,
	"reduction_reason" text,
	"window_ends" date NOT NULL,
	"window_extended_days" integer,
	"window_extension_reason" text,
	"status" "settlement_status" DEFAULT 'open' NOT NULL,
	"settled_on" date,
	"handled_by" integer,
	"replacement_copy_id" integer,
	"waiver_reason" text,
	"found_on" date,
	"found_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_settlement_amounts" CHECK ("book_settlement"."set_amount_cents" > 0 AND "book_settlement"."amount_due_cents" > 0
        AND "book_settlement"."amount_due_cents" <= "book_settlement"."set_amount_cents"
        AND ("book_settlement"."tariff_cents" IS NULL OR "book_settlement"."tariff_cents" >= 0)
        AND ("book_settlement"."tariff_cents" IS NULL OR "book_settlement"."tariff_cents" = "book_settlement"."set_amount_cents"
          OR "book_settlement"."amount_reason" IS NOT NULL)
        AND ("book_settlement"."amount_due_cents" = "book_settlement"."set_amount_cents" OR "book_settlement"."reduction_reason" IS NOT NULL)),
	CONSTRAINT "book_settlement_window" CHECK ("book_settlement"."window_ends" > "book_settlement"."declared_on"
        AND ("book_settlement"."window_extended_days" IS NULL) = ("book_settlement"."window_extension_reason" IS NULL)
        AND ("book_settlement"."window_extended_days" IS NULL OR "book_settlement"."window_extended_days" > 0)),
	CONSTRAINT "book_settlement_outcome" CHECK (CASE "book_settlement"."status"
        WHEN 'open' THEN "book_settlement"."settled_on" IS NULL AND "book_settlement"."replacement_copy_id" IS NULL
          AND "book_settlement"."waiver_reason" IS NULL
        WHEN 'replaced' THEN "book_settlement"."settled_on" IS NOT NULL AND "book_settlement"."replacement_copy_id" IS NOT NULL
        WHEN 'paid' THEN "book_settlement"."settled_on" IS NOT NULL
        WHEN 'waived' THEN "book_settlement"."settled_on" IS NOT NULL AND "book_settlement"."waiver_reason" IS NOT NULL
        WHEN 'found' THEN "book_settlement"."settled_on" IS NOT NULL AND "book_settlement"."found_on" IS NOT NULL
      END
      AND ("book_settlement"."found_on" IS NULL) = ("book_settlement"."found_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "lost_tariff" (
	"branch_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"amount_cents" bigint,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_tariff_branch_id_category_code_pk" PRIMARY KEY("branch_id","category_code"),
	CONSTRAINT "lost_tariff_amount" CHECK ("lost_tariff"."amount_cents" IS NULL OR "lost_tariff"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_payment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "settlement_payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"settlement_id" integer NOT NULL,
	"kind" "settlement_payment_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"receipt_no" text,
	"collected_by" integer NOT NULL,
	"reason" text,
	"reverses_payment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_payment_by_kind" CHECK (CASE "settlement_payment"."kind"
        WHEN 'payment' THEN "settlement_payment"."amount_cents" > 0 AND "settlement_payment"."receipt_no" IS NOT NULL
          AND "settlement_payment"."reverses_payment_id" IS NULL
        WHEN 'reversal' THEN "settlement_payment"."amount_cents" < 0 AND "settlement_payment"."reason" IS NOT NULL
          AND "settlement_payment"."reverses_payment_id" IS NOT NULL
      END)
);
--> statement-breakpoint
ALTER TABLE "borrow" DROP CONSTRAINT "borrow_received_when_returned";--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "lost_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "borrow" ADD COLUMN "lost_declared_by" integer;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_borrow_id_borrow_id_fk" FOREIGN KEY ("borrow_id") REFERENCES "public"."borrow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_copy_id_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_copy_branch_id_branch_id_fk" FOREIGN KEY ("copy_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_declared_by_app_user_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_amount_set_by_app_user_id_fk" FOREIGN KEY ("amount_set_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_handled_by_app_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settlement" ADD CONSTRAINT "book_settlement_replacement_copy_id_copy_id_fk" FOREIGN KEY ("replacement_copy_id") REFERENCES "public"."copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_tariff" ADD CONSTRAINT "lost_tariff_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_tariff" ADD CONSTRAINT "lost_tariff_category_code_category_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."category"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_tariff" ADD CONSTRAINT "lost_tariff_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payment" ADD CONSTRAINT "settlement_payment_settlement_id_book_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."book_settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payment" ADD CONSTRAINT "settlement_payment_collected_by_app_user_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payment" ADD CONSTRAINT "settlement_payment_reverses_payment_id_settlement_payment_id_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "public"."settlement_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_settlement_one_per_loan" ON "book_settlement" USING btree ("borrow_id");--> statement-breakpoint
CREATE INDEX "book_settlement_user_idx" ON "book_settlement" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "book_settlement_open_idx" ON "book_settlement" USING btree ("branch_id","window_ends") WHERE "book_settlement"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_payment_reversed_once" ON "settlement_payment" USING btree ("reverses_payment_id");--> statement-breakpoint
CREATE INDEX "settlement_payment_settlement_idx" ON "settlement_payment" USING btree ("settlement_id");--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_lost_declared_by_app_user_id_fk" FOREIGN KEY ("lost_declared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrow" ADD CONSTRAINT "borrow_received_when_returned" CHECK (("borrow"."returned_on" IS NULL) = ("borrow"."received_by" IS NULL AND "borrow"."lost_declared_at" IS NULL)
        AND ("borrow"."received_by" IS NULL OR "borrow"."lost_declared_at" IS NULL)
        AND ("borrow"."lost_declared_at" IS NULL) = ("borrow"."lost_declared_by" IS NULL));--> statement-breakpoint
-- §9 (R12, FR-LST-07): nothing about a lost book is deleted, and lost-book money
-- entries are never changed; a mistake or a refund is a reversing entry.
CREATE TRIGGER book_settlement_no_delete BEFORE DELETE ON book_settlement
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER lost_tariff_no_delete BEFORE DELETE ON lost_tariff
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER settlement_payment_no_delete BEFORE DELETE ON settlement_payment
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER settlement_payment_no_update BEFORE UPDATE ON settlement_payment
  FOR EACH ROW EXECUTE FUNCTION refuse_update();--> statement-breakpoint
CREATE TRIGGER book_settlement_updated_at BEFORE UPDATE ON book_settlement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER lost_tariff_updated_at BEFORE UPDATE ON lost_tariff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Missed in 0007: requests are kept for good too, and their updated_at kept true.
CREATE TRIGGER book_request_no_delete BEFORE DELETE ON book_request
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER book_request_updated_at BEFORE UPDATE ON book_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
