# Pothgula — Library Management System

Web-based, multi-branch library management system. **Status: design phase — no application code yet.**

- Designer / owner: Chathuranga Jayawardhana (Software Engineer)
- Baseline design: `docs/requirements-v3.html` (client-facing SRS, v3.0, 2026-09-22). Treat it as the source of truth for scope; anything not in it is out of scope until the client approves it. v1.0 (`requirements.html`) and v2.0 (`requirements-v2.html`) are kept as history; `docs/issues.txt` is the client's raw notes behind v3.
- Stack (proposed in `docs/tech-stack-decision.html`, not yet accepted): PostgreSQL 17, NestJS, React + Vite, Docker Compose. Do not write code against it until it is agreed.

## Domain vocabulary

| Term | Meaning |
|---|---|
| Branch | One physical library location with a fixed two-letter code (`KS`). Every book copy and every member belongs to one home branch. |
| Category | A book category with a fixed letter+digit code (`A1`) and a readable name. |
| Accession number | Human-readable id printed on a physical copy, format `KS-A1-01234` (branch code, category code, five-digit running number per branch+category). Immutable once allocated. |
| Member | `user_type = normal` — borrows books at their home branch only. Self-registration creates a *pending* application; staff approve it and the one-year membership runs from approval. Renewed by an annual fee. |
| Applicant | A pending member: can sign in and browse everything, cannot borrow, request or extend. |
| Admin (Librarian) | Branch-scoped staff: approve members, issue/return, extensions, requests, notices, open hours, payments, lost-book amounts. Cannot delete. |
| Super admin | Organisation-wide staff: everything an admin can do at any branch, plus branches, codes, logos, categories, staff, the annual fee, deletes and waivers. |
| Issue / Take back | Lending a copy to a member / receiving it back. Loan period 2 weeks; one 2-week extension per loan on request, approved by staff, counted from the original due date. |
| Request | A member asking for a copy shelved at another branch; the copy travels to the home branch and back (requested → in transit → held → issued → returning). |
| Settlement | What a member owes for a lost copy: an identical replacement or an amount set by staff, within a 100-day window; one book may be borrowed meanwhile. |

## Design decisions already made (v1 → v3)

- Roles are `normal`, `admin`, `super_admin`; super admin registration is gated by a pre-shared bootstrap code.
- Free and open-source: no paid third-party service anywhere (NFR-11). No SMS/WhatsApp/email sending; all alerts are dashboard-only.
- Sign-in name is the member's WhatsApp number (string, unique). Member also has `other_phone`, `organisation`, `introduced_by_name` (required) and `date_of_birth` (required).
- Max 2 books per member; 1 while a lost-book settlement is open; none after the 100-day window lapses.
- Book price optional; the lost-book amount is set by staff at declaration (2× price is only a suggestion).
- Staff are warned of loans due within 5 days; members at 3 days. Late returns are called out at the counter and kept on the member's record.
- Every data change by anyone is logged, append-only; reads are not logged. Logs and reports export as text, spreadsheet and PDF, generated locally.
- Images (branch logos, notice/event pictures) are stored in the system's own database, resized on upload; never on an external host.

## Open design questions

`docs/requirements-v3.html` §18 (recommendations R1, R2, R4, R5, R9, R12–R17) and §21 (22 questions) list what is **not yet accepted** — notably splitting `book` into title + copy, dropping the role picker from login, a single-use bootstrap code, what happens after day 100 of a settlement, who the "introducer" is, and fines for late returns. Confirm with Chathuranga before implementing any of them; do not silently "fix" the schema.

## Conventions

- All timestamps stored UTC; the library operates in Asia/Colombo (UTC+5:30). Render in local time. Due dates and windows are computed by date, not hour.
- Phone numbers are strings (Sri Lankan mobiles have a leading `0`), never numeric.
- Money is stored in cents/integer LKR, never float.
