#!/bin/sh
# NFR-08: proves a backup can be restored, without touching the live database.
# Restores the newest backup (or the one named) into a scratch database,
# compares the main tables with the live ones, and removes the scratch copy.
#   docker compose exec backup sh /scripts/restore-rehearsal.sh [pothgula-YYYY-MM-DD.dump]
# Do this before handover and every six months; keep the output as the record.
set -eu

if [ "$#" -gt 0 ]; then file="/backups/$1"; else file=$(ls -1t /backups/pothgula-*.dump | head -n 1); fi
[ -f "${file}" ] || { echo "No backup found at ${file}" >&2; exit 1; }
scratch=pothgula_restore_check

echo "Restore rehearsal, $(date -Iseconds)"
echo "Backup: ${file} ($(du -h "${file}" | cut -f1))"

dropdb --if-exists "${scratch}" 2> /dev/null
createdb "${scratch}"
trap 'dropdb --if-exists "${scratch}" 2> /dev/null' EXIT

pg_restore --dbname="${scratch}" --no-owner --exit-on-error "${file}"
echo "Restored into a scratch database without errors."
echo

count() { psql --dbname="$1" --tuples-only --no-align --command="SELECT count(*) FROM $2"; }
printf '%-20s %10s %10s\n' table backup live
for t in app_user branch title copy borrow membership_payment image activity_log; do
  printf '%-20s %10s %10s\n' "${t}" "$(count "${scratch}" "${t}")" "$(count "${PGDATABASE}" "${t}")"
done
echo
echo "Newest change in the backup: $(psql --dbname="${scratch}" --tuples-only --no-align \
  --command="SELECT max(at) AT TIME ZONE 'Asia/Colombo' FROM activity_log")"
echo "The live counts may be higher: they include everything since the backup."
echo "Rehearsal passed."
