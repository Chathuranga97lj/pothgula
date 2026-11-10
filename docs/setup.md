# Installing and running Pothgula

This guide is for the person who installs Pothgula for the library and looks after it afterwards. It covers:
- installing it on a server;
- creating the first super admin;
- the nightly backups, and copying them off the server;
- rehearsing a restore, and restoring for real;
- updating;
- running a public demonstration.

Everything runs from one setup file, `infra/compose.yml` (NFR-13). No account with any outside service is needed, and nothing costs money per message or per user (NFR-11). The one choice that may cost money is where to run it: a machine at the library, or a small rented server that every branch can reach.

## 1. What the server needs

- **Operating system:** Linux, for example Ubuntu Server 24.04 LTS, with Docker Engine and its Compose plugin installed. Docker's own instructions are at <https://docs.docker.com/engine/install/>.
- **Size:** 2 CPU cores, 2 GB of memory and 20 GB of disk are plenty for the library's size. Keep at least as much free disk again for backups.
- **Network:** ports 80 and 443 open to the branches.
- **For HTTPS:** a domain name (for example `library.example.lk`) pointed at the server. Without one, Pothgula still runs over plain HTTP, which is acceptable only on the library's own network.

## 2. Install

```sh
git clone https://github.com/Chathuranga97lj/pothgula.git /opt/pothgula
cd /opt/pothgula
git checkout v0.1.0            # the release being installed
cd infra
cp .env.example .env
nano .env                       # see below
docker compose up -d --build
```

In `.env`:

- **`POSTGRES_PASSWORD`:** letters and digits only, at least 24 characters. `openssl rand -hex 24` makes one. Write it down somewhere safe, away from the server.
- **`SITE_ADDRESS`:** the domain name, for free, automatic HTTPS. Use `:80` for plain HTTP on the library network.
- **`BACKUP_AT`:** the time of the nightly backup, Colombo time. 01:30 is the default.

The first start takes a few minutes, because it builds the system from source. When it finishes, check it:

```sh
docker compose ps                         # four services, all "running"
curl http://localhost/api/health          # {"status":"ok",...}
```

Then open the site in a browser.

## 3. The first super admin

The first super admin is created on the server, never through the website, and only once (FR-AUT-04):

```sh
docker compose exec api node dist/cli/create-super-admin.js --name "Full Name" --phone 07XXXXXXXX
```

It prints a temporary password. Give it to that person in private; they must change it when they first sign in. Once signed in, they should:

1. create a **second super admin**, so one can always help the other (FR-AUT-14);
2. set the library's name and logo, then create the branches, the categories (requirements §5) and the librarians.

If every super admin is ever locked out, this command issues a new temporary password. It is logged, like everything else.

```sh
docker compose exec api node dist/cli/reset-super-admin.js --phone 07XXXXXXXX
```

## 4. Bringing in the books already on the shelves

A librarian or super admin goes to **Catalogue → Import the old catalogue**. The screen explains the spreadsheet, which has one row per physical book, and offers an empty template.

Only the rows' problems and probable duplicates need attention. Every copy then gets a new number, its old number is kept, and the new spine labels are printed (FR-CAT-13). Do one branch at a time. Download the list of old and new numbers and keep it with the old card index.

## 5. Backups (NFR-08)

The `backup` service takes a full copy of the database every night, including every image. Each copy goes into `infra/backups/` as `pothgula-YYYY-MM-DD.dump`, and the newest 30 are kept. If the server was off at backup time, the backup is taken as soon as it is running again.

To take one now, for example before an update:

```sh
docker compose exec backup sh /scripts/backup-now.sh
```

To check that the backups are happening:

```sh
ls -lh infra/backups/
docker compose logs backup
```

### Copying backups off the server

A server can fail along with everything on it, so a copy must leave the server **at least weekly** for a computer the library owns. The **named super admin responsible** should check each week that it arrived.

On a **Windows** computer at the library (Windows 10 and 11 include `ssh` and `scp`):

1. Make a key, once, in PowerShell: `ssh-keygen -t ed25519`. Accept the defaults and set no passphrase, so that the scheduled task can use it.
2. Add the contents of `C:\Users\<you>\.ssh\id_ed25519.pub` to `~/.ssh/authorized_keys` on the server, for the account that can read `/opt/pothgula/infra/backups`.
3. Copy `infra/backup/copy-off-server.ps1` to the computer and try it once:

   ```powershell
   powershell -ExecutionPolicy Bypass -File copy-off-server.ps1 `
     -Server user@server-address -RemoteDir /opt/pothgula/infra/backups -LocalDir D:\PothgulaBackups
   ```

4. In Task Scheduler, run the same command weekly.

On **Linux or macOS**, use `infra/backup/copy-off-server.sh` from cron in the same way.

The off-server copies are never deleted by the script. Delete old ones by hand when the disk fills, and always keep at least the last eight weeks. The `log-archive` folder beside them is different: keep every file in it (see below).

### The activity log archive (FR-LOG-11)

The activity log is never edited or deleted from inside the application. Once an entry is older than its branch's retention period (`logRetentionMonths` in branch settings: at least 24 months, and 24 by default), the API moves it to an archive file. Entries with no branch, such as a super admin's or the system's, are kept as long as the longest-keeping branch keeps its own. Each run writes `activity-log-<first>-<last>.jsonl.gz` (one entry per line, as JSON, gzipped) and a `.sha256` beside it. It reads the file back before removing anything, and writes a `log.archive` entry naming the file and what it holds. The database itself refuses to remove any entry younger than 24 months.

The files are written to the `pothgula_log-archive` volume. Each nightly backup copies new ones into `infra/backups/log-archive/`, and both copy-off scripts fetch that folder too. Nothing ever deletes them, so **keep them for as long as the library keeps its records**. To check one and read it:

```sh
cd infra/backups/log-archive
sha256sum -c activity-log-1-10000.jsonl.gz.sha256
gunzip -c activity-log-1-10000.jsonl.gz | less
```

### Rehearsing a restore

A backup that has never been restored is a hope, not a backup. Before handover, and every six months after (NFR-08), run:

```sh
docker compose exec backup sh /scripts/restore-rehearsal.sh
```

It restores the newest backup into a scratch database, which never touches the live one. It then prints the main tables' row counts beside the live ones, and the time of the newest change in the backup, and removes the scratch copy. **Keep its output as the record of the rehearsal.** To rehearse with an off-server copy, put the file in `infra/backups/` first and name it:

```sh
docker compose exec backup sh /scripts/restore-rehearsal.sh pothgula-2026-11-02.dump
```

### Restoring for real

This applies only when the database is broken or lost. **Everything since that backup is lost**, so note what was done at the counter since then and re-enter it afterwards; back-dated entry allows up to seven days (FR-CIR-14).

```sh
docker compose stop api web
docker compose exec backup sh /scripts/restore-live.sh pothgula-YYYY-MM-DD.dump --replace-live-database
docker compose start api web
```

On a **new server**, follow these steps in order:
1. Install as in section 2, using the same `POSTGRES_PASSWORD`.
2. Put the backup file in `infra/backups/`.
3. Run the three commands above.
4. Do **not** create a super admin: the accounts come back with the data.

## 6. Updating to a new release

```sh
cd /opt/pothgula
docker compose -f infra/compose.yml exec backup sh /scripts/backup-now.sh   # first, always
git fetch --tags && git checkout v0.2.0
cd infra && docker compose up -d --build
```

Database changes are applied automatically when the API starts. Set `POTHGULA_VERSION` in `.env` to the new version, so that the health check shows it.

## 7. A public demonstration (NFR-17)

A demonstration for people to try runs **separately, with invented data only**. It is never connected to the real installation and never holds a real member's details. It can run on any free or cheap host that runs Docker, from the same files:

```sh
cd infra && cp .env.example .env    # its own password and address
docker compose up -d --build
docker compose exec -e POTHGULA_DEMO=yes api node dist/cli/seed.js
docker compose exec api node dist/cli/create-super-admin.js --name "Demo Admin" --phone 0770000000
```

The demonstration data is invented: branches, categories and books in Sinhala, Tamil and English. It loads only into an empty database. `POTHGULA_DEMO=yes` is required because the production build otherwise refuses to load it at all.

## 8. Where things are

| What | Where |
| --- | --- |
| Settings | `infra/.env` (private: it holds the database password) |
| Database files | Docker volume `pothgula_db-data` |
| HTTPS certificates | Docker volume `pothgula_caddy-data` |
| Nightly backups | `infra/backups/` |
| Activity log archive files | Docker volume `pothgula_log-archive`, copied to `infra/backups/log-archive/` |
| Backup and restore scripts | `infra/backup/` |
| Logs | `docker compose logs api` (or `web`, `db`, `backup`) |
