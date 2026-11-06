import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useMe, useAuth } from '../auth/auth';
import { LanguageSelect } from './LanguageSelect';
import { Button } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-100'
  }`;

export function Layout() {
  const { t } = useTranslation();
  const { user } = useMe();
  const { signOut } = useAuth();
  const isStaff = user.userType !== 'member';

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="mr-auto">
            <p className="text-xl font-semibold text-emerald-900">{t('app.name')}</p>
            <p className="text-xs text-stone-600">
              {user.fullName} · {t(`roles.${user.userType}`)}
            </p>
          </div>
          {!user.mustChangePassword && (
            <nav className="flex gap-1" aria-label={t('nav.label')}>
              <NavLink to="/" end className={navClass}>
                {t('nav.home')}
              </NavLink>
              {isStaff && (
                <NavLink to="/staff" className={navClass}>
                  {t('nav.staff')}
                </NavLink>
              )}
              <NavLink to="/change-password" className={navClass}>
                {t('nav.changePassword')}
              </NavLink>
            </nav>
          )}
          <LanguageSelect />
          <Button variant="secondary" onClick={() => void signOut()}>
            {t('nav.signOut')}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
