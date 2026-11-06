-- The library's name and logo are library-wide (FR-BRN-03, FR-BRN-04): hold them
-- once, in a single-row table, instead of copying library_name onto every branch.
CREATE TABLE "library" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"logo_image_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_single_row" CHECK ("library"."id" = 1),
	CONSTRAINT "library_name_not_blank" CHECK (btrim("library"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "library" ADD CONSTRAINT "library_logo_image_id_image_id_fk" FOREIGN KEY ("logo_image_id") REFERENCES "public"."image"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Keep the name already in use, if any branch exists; otherwise a placeholder the
-- super admin renames at installation.
INSERT INTO "library" ("id", "name")
SELECT 1, COALESCE((SELECT "library_name" FROM "branch" ORDER BY "id" LIMIT 1), 'Pothgula Library');
--> statement-breakpoint
ALTER TABLE "branch" DROP COLUMN "library_name";
--> statement-breakpoint
CREATE TRIGGER library_updated_at BEFORE UPDATE ON library
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER library_no_delete BEFORE DELETE ON library
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
