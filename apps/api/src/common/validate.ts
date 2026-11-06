import type { z } from 'zod';
import { AppError } from './app-error';

/** Parses a request body with a shared Zod schema, or answers 400 with the issues. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw AppError.badRequest(
      'invalid_request',
      'Some of the information sent is missing or not valid.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** A positive integer route parameter, or 400. */
export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw AppError.badRequest('invalid_id', `Not a valid id: ${value}`);
  }
  return id;
}
