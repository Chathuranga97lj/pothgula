import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@pothgula/shared';
import type { Response } from 'express';
import { AppError } from './app-error';

/** Every error leaves the API as `{ code, message, details? }` (see `apiErrorSchema`). */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.describe(exception);
    res.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          code: status === HttpStatus.NOT_FOUND ? 'not_found' : 'http_error',
          message: exception.message,
        },
      };
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'internal_error', message: 'Something went wrong on the server.' },
    };
  }
}
