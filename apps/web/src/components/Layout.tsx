import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useBranches, useLibrary } from '../api/queries';
import { useMe, useAuth } from '../auth/auth';
import { Logo } from './images';
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
  const library = useLibrary();
  const branches = useBranches(!user.mustChangePassword);
  const home = branches.data?.find((b) => b.id === user.branchId);
  // FR-BRN-04: the home branch's logo, else the library's, else the name.
  const logoId = home?.logoImageId ?? library.data?.logoImageId ?? null;
  const libraryName = library.data?.name ?? t('app.name');

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="mr-auto flex min-w-0 items-center gap-3">
              <Logo imageId={logoId} name={libraryName} />
              <div className="min-w-0">
                <p className="text-lg leading-tight font-semibold text-emerald-900">
                  {libraryName}
                </p>
                <p className="text-xs text-stone-600">
                  {user.fullName} · {t(`roles.${user.userType}`)}
                  {home && ` · ${home.name}`}
                </p>
              </div>
            </div>
            <LanguageSelect />
            <Button variant="secondary" onClick={() => void signOut()}>
              {t('nav.signOut')}
            </Button>
          </div>
          {!user.mustChangePassword && (
            <nav className="-mx-3 mt-2 flex flex-wrap gap-1 pb-2" aria-label={t('nav.label')}>
              <NavLink to="/" end className={navClass}>
                {t('nav.home')}
              </NavLink>
              <NavLink to="/catalogue" className={navClass}>
                {t('nav.catalogue')}
              </NavLink>
              {!isStaff && (
                <NavLink to="/my-membership" className={navClass}>
                  {t('nav.myMembership')}
                </NavLink>
              )}
              {isStaff && (
                <>
                  <NavLink to="/counter" className={navClass}>
                    {t('nav.counter')}
                  </NavLink>
                  <NavLink to="/due" className={navClass}>
                    {t('nav.due')}
                  </NavLink>
                  <NavLink to="/members" className={navClass}>
                    {t('nav.members')}
                  </NavLink>
                  <NavLink to="/branches" className={navClass}>
                    {t('nav.branches')}
                  </NavLink>
                  <NavLink to="/categories" className={navClass}>
                    {t('nav.categories')}
                  </NavLink>
                  <NavLink to="/staff" className={navClass}>
                    {t('nav.staff')}
                  </NavLink>
                  <NavLink to="/log" className={navClass}>
                    {t('nav.log')}
                  </NavLink>
                </>
              )}
              <NavLink to="/change-password" className={navClass}>
                {t('nav.changePassword')}
              </NavLink>
            </nav>
          )}
          {user.mustChangePassword && <div className="pb-3" />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
