import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserType } from '@pothgula/shared';
import { AppError } from '../common/app-error';
import {
  ALLOW_WHILE_MUST_CHANGE,
  type AuthedRequest,
  actorFor,
  IS_PUBLIC,
  ROLES,
} from './auth-context';
import { SessionService } from './session.service';

/**
 * Applied to every route (NFR-06: checked on the server for every request).
 * Routes are closed unless marked @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
    const resolved = token ? await this.sessions.resolve(token) : null;
    if (!resolved) {
      throw AppError.unauthorized('not_signed_in', 'Please sign in.');
    }

    const { user, tokenHash } = resolved;
    req.auth = { user, tokenHash, actor: actorFor(user, req.ip ?? null) };

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_MUST_CHANGE, targets)
    ) {
      throw AppError.forbidden(
        'must_change_password',
        'Please choose a new password before continuing.',
      );
    }

    const roles = this.reflector.getAllAndOverride<UserType[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.userType)) {
      throw AppError.forbidden('forbidden', 'You do not have permission to do this.');
    }
    return true;
  }
}
