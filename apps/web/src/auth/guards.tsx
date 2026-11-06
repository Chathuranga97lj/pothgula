import type { UserType } from '@pothgula/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth';

/** Screens for signed-in people. A temporary password must be replaced first (FR-AUT-12). */
export function RequireAuth() {
  const { me } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (me === undefined) {
    return <p className="p-8 text-stone-600">{t('common.loading')}</p>;
  }
  if (me === null) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  if (me.user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/** Hides a screen from roles that may not use it. The API enforces the same rule. */
export function RequireRole({ roles, children }: { roles: UserType[]; children: ReactNode }) {
  const { me } = useAuth();
  if (!me || !roles.includes(me.user.userType)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
