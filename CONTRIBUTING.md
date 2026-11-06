# Contributing

## Scope

[`docs/requirements-v3.1.html`](docs/requirements-v3.1.html) is the source of truth. Work that is not in it is out of scope until the library agrees to it. If you find a gap or a contradiction while building, raise it in the pull request rather than deciding it quietly in code.

## Workflow

- Branch from `main`: `feat/<milestone>-<topic>`, `fix/<topic>`, `chore/<topic>`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(api): issue a copy to a member`.
- Open a pull request using the template; list the requirement IDs it covers.
- `main` is protected; pull requests are squash-merged after review and green CI.

## Rules that are easy to break

- **Timestamps** are stored in UTC. Business dates (due dates, holds, the 100-day window) are calendar dates in Asia/Colombo; use `todayColombo()` and `addDays()` from `@pothgula/shared`, never the server clock's date.
- **Money** is integer cents of LKR (`bigint` in the database). Never a float.
- **Phone numbers** are strings. Sri Lankan mobiles start with `0`.
- **Nothing is deleted** — records are withdrawn, voided, deactivated or anonymised (requirement R12).
- **Every change writes an activity log entry in the same transaction** (FR-LOG-13).
- **No paid or external services**, including fonts and images (NFR-11, NFR-16).
- **No real member data** in code, tests, fixtures or the demonstration deployment (NFR-17). Use invented names — in Sinhala and Tamil as well as English.
