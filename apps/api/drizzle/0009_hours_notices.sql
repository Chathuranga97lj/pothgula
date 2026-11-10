CREATE TYPE "public"."notice_kind" AS ENUM('notice', 'event');--> statement-breakpoint
CREATE TABLE "branch_closure" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branch_closure_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"branch_id" integer NOT NULL,
	"closed_on" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" integer,
	CONSTRAINT "branch_closure_reason" CHECK (btrim("branch_closure"."reason") <> ''),
	CONSTRAINT "branch_closure_withdrawn" CHECK (("branch_closure"."withdrawn_at" IS NULL) = ("branch_closure"."withdrawn_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "branch_schedule" (
	"branch_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"open_time" time,
	"close_time" time,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_schedule_branch_id_weekday_pk" PRIMARY KEY("branch_id","weekday"),
	CONSTRAINT "branch_schedule_weekday" CHECK ("branch_schedule"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "branch_schedule_times" CHECK (("branch_schedule"."open_time" IS NULL) = ("branch_schedule"."close_time" IS NULL)
        AND ("branch_schedule"."open_time" IS NULL OR "branch_schedule"."open_time" < "branch_schedule"."close_time"))
);
--> statement-breakpoint
CREATE TABLE "notice" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notice_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "notice_kind" NOT NULL,
	"branch_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"image_id" integer,
	"event_date" date,
	"start_time" time,
	"end_time" time,
	"venue" text,
	"show_from" date,
	"show_until" date,
	"is_important" boolean DEFAULT false NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_text" CHECK (btrim("notice"."title") <> '' AND btrim("notice"."body") <> ''),
	CONSTRAINT "notice_event" CHECK (("notice"."kind" = 'event') = ("notice"."event_date" IS NOT NULL AND "notice"."start_time" IS NOT NULL)
        AND ("notice"."kind" = 'event' OR ("notice"."end_time" IS NULL AND "notice"."venue" IS NULL))
        AND ("notice"."end_time" IS NULL OR "notice"."end_time" > "notice"."start_time")),
	CONSTRAINT "notice_shown" CHECK ("notice"."show_from" IS NULL OR "notice"."show_until" IS NULL OR "notice"."show_until" >= "notice"."show_from")
);
--> statement-breakpoint
CREATE TABLE "notice_read" (
	"notice_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_read_notice_id_user_id_pk" PRIMARY KEY("notice_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "branch_closure" ADD CONSTRAINT "branch_closure_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_closure" ADD CONSTRAINT "branch_closure_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_closure" ADD CONSTRAINT "branch_closure_withdrawn_by_app_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_schedule" ADD CONSTRAINT "branch_schedule_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_schedule" ADD CONSTRAINT "branch_schedule_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_image_id_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_read" ADD CONSTRAINT "notice_read_notice_id_notice_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_read" ADD CONSTRAINT "notice_read_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_closure_one_per_day" ON "branch_closure" USING btree ("branch_id","closed_on") WHERE "branch_closure"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notice_branch_idx" ON "notice" USING btree ("branch_id","created_at");--> statement-breakpoint
-- §11, §12 (R12): hours, closures and notices are never deleted; a closure or a
-- notice is withdrawn instead.
CREATE TRIGGER branch_schedule_no_delete BEFORE DELETE ON branch_schedule
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER branch_closure_no_delete BEFORE DELETE ON branch_closure
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER notice_no_delete BEFORE DELETE ON notice
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();--> statement-breakpoint
CREATE TRIGGER branch_schedule_updated_at BEFORE UPDATE ON branch_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER notice_updated_at BEFORE UPDATE ON notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
