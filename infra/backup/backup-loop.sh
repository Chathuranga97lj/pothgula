#!/bin/sh
# NFR-08: runs in the backup container and takes one backup a night at
# BACKUP_AT (Colombo time). A missed night (the server was off) is taken as
# soon as the container is running again after that time.
set -eu

echo "Nightly backup at ${BACKUP_AT} (${TZ}); keeping the newest ${BACKUP_KEEP}."
while :; do
  today=$(date +%F)
  if [ "$(date +%H:%M)" \> "${BACKUP_AT}" ] || [ "$(date +%H:%M)" = "${BACKUP_AT}" ]; then
    if [ ! -e "/backups/pothgula-${today}.dump" ]; then
      /bin/sh /scripts/backup-now.sh || echo "$(date -Iseconds) backup FAILED; will try again in 10 minutes" >&2
    fi
  fi
  sleep 600
done
