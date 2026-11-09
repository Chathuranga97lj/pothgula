/** What `apps/api/test/e2e-prepare.ts` puts in the database. Keep the two in step. */
export const E2E = {
  password: 'e2e-counter-pass-71',
  librarian: { fullName: 'Kumudu Librarian', whatsappPhone: '0770000001' },
  member: { fullName: 'Saman Wickrama', whatsappPhone: '0770000002' },
  /** On loan to the member, six days overdue. */
  overdueCopy: 'KS-A1-00001',
  overdueDays: 6,
  /** On the shelf at Kesbewa, same title. */
  shelfCopy: 'KS-A1-00002',
  /** Kesbewa's loan period and limit (the defaults). */
  loanDays: 14,
  maxBooks: 2,
} as const;
