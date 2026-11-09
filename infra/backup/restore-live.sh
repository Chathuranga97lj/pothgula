#!/bin/sh
# Disaster recovery: REPLACES the live database with a backup. Everything since
# that backup is lost, so this is only for a broken or lost database. Stop the
# API first, so nobody works on the copy being replaced:
#   docker compose stop api web
#   docker compose exec backup sh /scripts/restore-live.sh pothgula-YYYY-MM-DD.dump --replace-live-database
#   docker compose start api web
# Run restore-rehearsal.sh on the same file first if there is time.
set -eu

[ "$#" -eq 2 ] && [ "$2" = "--replace-live-database" ] || {
  echo "Usage: restore-live.sh pothgula-YYYY-MM-DD.dump --replace-live-database" >&2
  exit 2
}
file="/backups/$1"
[ -f "${file}" ] || { echo "No backup at ${file}" >&2; exit 1; }
pg_restore --list "${file}" > /dev/null

live="${PGDATABASE}"
echo "$(date -Iseconds) replacing database ${live} with ${file}"
# Connect to the maintenance database, so the live one can be dropped.
export PGDATABASE=postgres
dropdb --force "${live}"
createdb "${live}"
pg_restore --dbname="${live}" --no-owner --exit-on-error "${file}"
echo "$(date -Iseconds) restored. Start the API again: docker compose start api web"
