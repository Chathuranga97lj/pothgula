# Translating Pothgula

Every word on the screens lives in one file per language in `apps/web/src/locales/`: `en.json` (English, the reference) and `si.json` (Sinhala). NFR-04 asks for English and Sinhala at launch, and for Tamil to be addable as one more file with no change to the software. The PDFs (sheets, labels, exports) are in English for now.

## Reviewing the Sinhala

The Sinhala in v0.1.0 was written by the developer, not a native speaker, and needs a native speaker's reading before the library uses it.

1. Export the strings as a spreadsheet:

   ```sh
   pnpm --filter @pothgula/web i18n:export si translations-si.csv
   ```

2. The reviewer opens it in Excel. The columns are `key` (leave it alone), `english`, and `si`. Correct the `si` column. Save it with **Save as → CSV UTF-8 (Comma delimited)**.
3. Bring it back:

   ```sh
   pnpm --filter @pothgula/web i18n:import si translations-si.csv
   ```

   The import reports how many strings changed. It skips any row where a `{{name}}` placeholder was altered: those stand for a number, date or name that the screen fills in, and must stay exactly as they are, although they may move within the sentence.
4. Run `pnpm --filter @pothgula/web test`. It checks that every language has every string, with the same placeholders.

Some keys come in pairs ending `_one` and `_other`: the wording for one thing and for several. In Sinhala both are often the same sentence, which is fine.

### Words to settle first

These terms appear all over the system, so a change to one should be made everywhere. These are the words used today:

| English | Sinhala used | Notes |
| --- | --- | --- |
| member | සාමාජිකයා | |
| applicant / application | අයදුම්කරු / අයදුම්පත | |
| branch | ශාඛාව | |
| title (a book as written) | මාතෘකාව | One title has many copies |
| copy (one physical book) | පිටපත | |
| book number (accession number) | පොත් අංකය | KS-A1-01234 |
| category | වර්ගය | Standardised in v0.1.0; ප්‍රවර්ගය was also used before |
| issue (lend) | නිකුත් කිරීම | |
| take back | ආපසු ගැනීම | |
| overdue | කල් ඉකුත් වූ | |
| days late | දින … ප්‍රමාදයි | |
| fee | ගාස්තුව | |
| withdraw (a copy) | ඉවත් කරන්න, ඉවත් කර ඇත | Nothing is deleted |
| librarian (admin) | පුස්තකාලයාධිපති | |
| super admin | ප්‍රධාන පරිපාලක | |
| counter | කවුන්ටරය | |

## Adding Tamil

1. Export with the new code. The third column comes out empty:

   ```sh
   pnpm --filter @pothgula/web i18n:export ta translations-ta.csv
   ```

2. Fill in the `ta` column. The first row, `languageName`, is the language's name as it appears in the language menu: `தமிழ்`.
3. Import it. This creates `src/locales/ta.json`:

   ```sh
   pnpm --filter @pothgula/web i18n:import ta translations-ta.csv
   ```

4. Rebuild and redeploy, as in [setup.md](setup.md), section 6. Tamil then appears in the language menu.

Until a string is translated, the English is shown in its place, so a partial translation can go live. The Tamil font is already part of the system.
