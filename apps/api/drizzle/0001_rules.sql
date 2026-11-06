-- Rules the database enforces itself, beyond column constraints (NFR-10, FR-LOG-05).
-- Hand-written: drizzle-kit cannot express triggers, views or extension indexes.

-- ─── updated_at ─────────────────────────────────────────────────────────────
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER branch_updated_at BEFORE UPDATE ON branch
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER category_updated_at BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER branch_setting_updated_at BEFORE UPDATE ON branch_setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER app_user_updated_at BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER title_updated_at BEFORE UPDATE ON title
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER copy_updated_at BEFORE UPDATE ON copy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER borrow_updated_at BEFORE UPDATE ON borrow
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ─── FR-BRN-02: a branch code is fixed once a copy carries it ──────────────
-- (FR-BRN-05 for category codes is enforced by the foreign keys from title and
-- accession_counter, which refuse to let a referenced code change.)
CREATE FUNCTION branch_code_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_code IS DISTINCT FROM OLD.branch_code
     AND EXISTS (SELECT 1 FROM copy WHERE accessioned_branch_id = OLD.id) THEN
    RAISE EXCEPTION 'Branch code % is printed on books and cannot change', OLD.branch_code
      USING ERRCODE = 'check_violation', CONSTRAINT = 'branch_code_locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER branch_code_locked BEFORE UPDATE OF branch_code ON branch
  FOR EACH ROW EXECUTE FUNCTION branch_code_locked();
--> statement-breakpoint

-- ─── FR-CAT-14: an accession number never changes ──────────────────────────
CREATE FUNCTION copy_identity_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accession_no IS DISTINCT FROM OLD.accession_no
     OR NEW.accessioned_branch_id IS DISTINCT FROM OLD.accessioned_branch_id THEN
    RAISE EXCEPTION 'The accession number of a copy never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'copy_identity_fixed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER copy_identity_fixed BEFORE UPDATE OF accession_no, accessioned_branch_id ON copy
  FOR EACH ROW EXECUTE FUNCTION copy_identity_fixed();
--> statement-breakpoint

-- ─── R12: nothing is deleted ────────────────────────────────────────────────
-- Records are withdrawn, voided, deactivated or anonymised instead. Sessions are
-- the one exception (they are revoked, but old rows may be pruned).
CREATE FUNCTION refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are never deleted (R12)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'no_delete';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER branch_no_delete BEFORE DELETE ON branch FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER category_no_delete BEFORE DELETE ON category FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER app_user_no_delete BEFORE DELETE ON app_user FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER title_no_delete BEFORE DELETE ON title FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER copy_no_delete BEFORE DELETE ON copy FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER borrow_no_delete BEFORE DELETE ON borrow FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER membership_payment_no_delete BEFORE DELETE ON membership_payment
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER image_no_delete BEFORE DELETE ON image FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint

-- ─── FR-CIR-05, FR-LST-07: payments are never edited ───────────────────────
CREATE FUNCTION refuse_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are never edited; record a reversing entry instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'no_update';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER membership_payment_no_update BEFORE UPDATE ON membership_payment
  FOR EACH ROW EXECUTE FUNCTION refuse_update();
--> statement-breakpoint

-- ─── FR-LOG-05: the activity log is append-only ────────────────────────────
-- The only permitted change is anonymisation (FR-AUT-20): inside a transaction
-- that has run `SET LOCAL pothgula.redacting = 'on'`, the before/after values
-- may be replaced and redacted_at set. Nothing else, ever.
CREATE FUNCTION activity_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('pothgula.redacting', true) = 'on'
     AND NEW.id = OLD.id AND NEW.at = OLD.at
     AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id AND NEW.actor_role = OLD.actor_role
     AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id AND NEW.action = OLD.action
     AND NEW.entity = OLD.entity AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
     AND NEW.redacted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The activity log is append-only (FR-LOG-05)'
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'activity_log_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_log_no_change BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();
--> statement-breakpoint
CREATE TRIGGER activity_log_no_truncate BEFORE TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION activity_log_append_only();
--> statement-breakpoint

-- ─── R2: availability is worked out, never stored ──────────────────────────
-- Phase 2 adds 'in_transit' and 'held' from book_request.
CREATE VIEW copy_availability AS
SELECT
  c.id AS copy_id,
  CASE
    WHEN c.withdrawn_at IS NOT NULL THEN 'withdrawn'
    WHEN c.condition = 'missing' THEN 'missing'
    WHEN c.condition = 'not_useable' THEN 'not_useable'
    WHEN b.id IS NOT NULL THEN 'on_loan'
    ELSE 'on_shelf'
  END AS state,
  b.id AS open_borrow_id
FROM copy c
LEFT JOIN borrow b
  ON b.copy_id = c.id AND b.returned_on IS NULL AND b.voided_at IS NULL;
--> statement-breakpoint

-- ─── Search (FR-CAT-01 duplicate warning, FR-CAT-07) ───────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX title_title_trgm_idx ON title USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX title_writer_trgm_idx ON title USING gin (writer gin_trgm_ops);
