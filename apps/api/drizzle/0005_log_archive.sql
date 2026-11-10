-- FR-LOG-11: entries past the retention period are moved to an archive file,
-- never destroyed. The append-only rule gains one narrow exception, alongside
-- the redaction one: a transaction that has run
-- `SET LOCAL pothgula.archiving = 'on'` may delete entries more than 24 months
-- old (the shortest retention a branch can set). The archive job writes and
-- checks the file first, and logs the move in the same transaction. Nothing
-- younger can ever be removed, and TRUNCATE stays refused.
CREATE OR REPLACE FUNCTION activity_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF TG_OP = 'DELETE'
     AND current_setting('pothgula.archiving', true) = 'on'
     AND OLD.at < now() - interval '24 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The activity log is append-only (FR-LOG-05)'
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'activity_log_append_only';
END;
$$;
