/** The PostgreSQL error behind a failed query (Drizzle wraps it in `cause`). */
export function pgErrorOf(error: unknown): { code?: string; constraint?: string } {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause ?? {}) as { code?: string; constraint?: string };
}

export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
} as const;

export function isPgError(error: unknown, code: string, constraint?: string): boolean {
  const pg = pgErrorOf(error);
  return pg.code === code && (constraint === undefined || pg.constraint === constraint);
}
