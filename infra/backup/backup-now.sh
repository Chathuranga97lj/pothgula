#!/bin/sh
# One full backup of the database, images included, as a compressed pg_dump
# archive: /backups/pothgula-YYYY-MM-DD.dump. Old ones beyond BACKUP_KEEP are
# removed. Run by hand with:
#   docker compose exec backup sh /scripts/backup-now.sh
set -eu

keep="${BACKUP_KEEP:-30}"
file="/backups/pothgula-$(date +%F).dump"

pg_dump --format=custom --no-owner --file="${file}.part"
# A backup that cannot be read back is not a backup.
pg_restore --list "${file}.part" > /dev/null
mv "${file}.part" "${file}"
echo "$(date -Iseconds) backup written: ${file} ($(du -h "${file}" | cut -f1))"

ls -1t /backups/pothgula-*.dump | tail -n +"$((keep + 1))" | while read -r old; do
  rm -- "${old}"
  echo "$(date -Iseconds) removed old backup ${old}"
done

# FR-LOG-11: activity log archive files, written by the API once entries pass
# their retention period. Copied beside the backups so they leave the server
# with them; never removed here.
if [ -d /log-archive ]; then
  mkdir -p /backups/log-archive
  for f in /log-archive/activity-log-*.jsonl.gz /log-archive/activity-log-*.jsonl.gz.sha256; do
    [ -e "${f}" ] || continue
    target="/backups/log-archive/$(basename "${f}")"
    if [ ! -e "${target}" ]; then
      cp "${f}" "${target}.part" && mv "${target}.part" "${target}"
      echo "$(date -Iseconds) log archive copied: ${target}"
    fi
  done
fi
