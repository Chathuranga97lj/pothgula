import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useBranches, useLibrary } from '../api/queries';
import { useMe, useAuth } from '../auth/auth';
import { Logo } from './images';
import { LanguageSelect } from './LanguageSelect';
import { Button } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap ${
    isActive ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-100'
  }`;

interface Item {
  to: string;
  label: string;
  end?: boolean;
}

/**
 * The staff's everyday screens stay in the row; the rest sit in "More", in
 * named groups. One set of links serves every width: the row wraps on a phone,
 * and the menu opens below it.
 */
function useNavItems(): { row: Item[]; more: { title: string; items: Item[] }[] } {
  const { t } = useTranslation();
  const { user } = useMe();
  if (user.userType === 'member') {
    return {
      row: [
        { to: '/', label: t('nav.home'), end: true },
        { to: '/notices', label: t('nav.notices') },
        { to: '/catalogue', label: t('nav.catalogue') },
        { to: '/my-membership', label: t('nav.myMembership') },
        { to: '/change-password', label: t('nav.changePassword') },
      ],
      more: [],
    };
  }
  return {
    row: [
      { to: '/', label: t('nav.home'), end: true },
      { to: '/counter', label: t('nav.counter') },
      { to: '/due', label: t('nav.due') },
      { to: '/members', label: t('nav.members') },
      { to: '/catalogue', label: t('nav.catalogue') },
      { to: '/requests', label: t('nav.requests') },
      { to: '/lost-books', label: t('nav.lostBooks') },
    ],
    more: [
      {
        title: t('nav.groups.library'),
        items: [
          { to: '/notices', label: t('nav.notices') },
          { to: '/reports', label: t('nav.reports') },
          { to: '/log', label: t('nav.log') },
        ],
      },
      {
        title: t('nav.groups.setup'),
        items: [
          { to: '/branches', label: t('nav.branches') },
          { to: '/categories', label: t('nav.categories') },
          { to: '/staff', label: t('nav.staff') },
        ],
      },
      {
        title: t('nav.groups.account'),
        items: [{ to: '/change-password', label: t('nav.changePassword') }],
      },
    ],
  };
}

/** "More": a disclosure that closes on a choice, on Escape, or on a click elsewhere. */
function MoreMenu({ groups }: { groups: { title: string; items: Item[] }[] }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const here = groups.some((g) =>
    g.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)),
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    // On a phone the wrapper steps aside (display: contents) so the open menu takes a
    // full line of the nav; from sm up it drops down under the button.
    <div ref={box} className="contents sm:relative sm:block">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap ${
          here || open ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-100'
        }`}
      >
        {t('nav.more')}
        <span
          aria-hidden="true"
          className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          id={id}
          className="basis-full rounded-md border border-stone-200 bg-white py-2 sm:absolute sm:top-full sm:right-0 sm:z-20 sm:mt-1 sm:w-60 sm:shadow-lg"
        >
          {groups.map((g) => (
            <div key={g.title} className="px-2 py-1">
              <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                {g.title}
              </p>
              <ul>
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) => `block w-full ${navClass({ isActive })}`}
                    >
                      {i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const { user } = useMe();
  const { signOut } = useAuth();
  const library = useLibrary();
  const branches = useBranches(!user.mustChangePassword);
  const home = branches.data?.find((b) => b.id === user.branchId);
  // FR-BRN-04: the home branch's logo, else the library's, else the name.
  const logoId = home?.logoImageId ?? library.data?.logoImageId ?? null;
  const libraryName = library.data?.name ?? t('app.name');
  const nav = useNavItems();

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
            <nav
              className="-mx-3 mt-2 flex flex-wrap items-center gap-1 pb-2"
              aria-label={t('nav.label')}
            >
              {nav.row.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={navClass}>
                  {i.label}
                </NavLink>
              ))}
              {nav.more.length > 0 && <MoreMenu groups={nav.more} />}
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
