#!/bin/sh
# NFR-08: copies the server's backups to a computer the library owns (Linux or
# macOS). Run weekly from cron on that computer, for example:
#   0 9 * * 1  /path/to/copy-off-server.sh pothgula@203.0.113.10 /opt/pothgula/infra/backups ~/PothgulaBackups
# Only new backups are fetched; copies here are never deleted by this script.
set -eu

[ "$#" -eq 3 ] || { echo "Usage: $0 user@server remote-backups-dir local-dir" >&2; exit 2; }
server=$1
remote=$2
local=$3

mkdir -p "${local}"
# The nightly dumps, and the activity log archive files (FR-LOG-11) beside them.
rsync --archive --ignore-existing --include='pothgula-*.dump' \
  --include='log-archive/' --include='log-archive/activity-log-*' --exclude='*' \
  "${server}:${remote}/" "${local}/"
echo "Newest here: $(ls -1 "${local}"/pothgula-*.dump | tail -n 1)"
