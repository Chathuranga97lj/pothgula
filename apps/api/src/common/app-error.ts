import { HttpStatus } from '@nestjs/common';

/**
 * An error meant for the person using the system. `code` is stable and is what
 * the web app translates; `message` is a plain English fallback.
 */
export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new AppError(HttpStatus.BAD_REQUEST, code, message, details);
  }
  static unauthorized(code: string, message: string, details?: unknown) {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message, details);
  }
  static forbidden(code: string, message: string) {
    return new AppError(HttpStatus.FORBIDDEN, code, message);
  }
  static notFound(code: string, message: string) {
    return new AppError(HttpStatus.NOT_FOUND, code, message);
  }
  static conflict(code: string, message: string) {
    return new AppError(HttpStatus.CONFLICT, code, message);
  }
  static unprocessable(code: string, message: string, details?: unknown) {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
}
