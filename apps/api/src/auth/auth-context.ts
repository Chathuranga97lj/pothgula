import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserType } from '@pothgula/shared';
import type { Request } from 'express';
import type { Actor } from '../audit/actor';
import type { UserRow } from './users';

/** Who is making this request, attached by AuthGuard. */
export interface AuthContext {
  user: UserRow;
  tokenHash: string;
  actor: Extract<Actor, { kind: 'user' }>;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}

export const IS_PUBLIC = 'pothgula:public';
export const ROLES = 'pothgula:roles';
export const ALLOW_WHILE_MUST_CHANGE = 'pothgula:allow-must-change';

/** No sign-in needed (sign-in itself, health). Everything else requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these roles may call the route. Branch scope is checked in the service. */
export const Roles = (...roles: UserType[]) => SetMetadata(ROLES, roles);

/**
 * Reachable while the user still has to replace a temporary password
 * (FR-AUT-12): changing it, signing out and reading who they are.
 */
export const AllowWhileMustChange = () => SetMetadata(ALLOW_WHILE_MUST_CHANGE, true);

/** The AuthContext of the current request. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('@Auth() used on a route without AuthGuard context');
  return req.auth;
});

export function clientMeta(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export function actorFor(user: UserRow, ipAddress: string | null): AuthContext['actor'] {
  return {
    kind: 'user',
    userId: user.id,
    role: user.userType,
    branchId: user.branchId,
    ipAddress,
  };
}
