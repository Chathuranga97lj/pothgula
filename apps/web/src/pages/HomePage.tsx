import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMe } from '../auth/auth';
import { MemberPanel, StaffToday } from '../components/dashboard';
import { HoursCard } from '../components/hours';
import { NoticeBoardView } from '../components/notices';
import { Alert, PageTitle } from '../components/ui';

/** §13: each dashboard opens on what needs the person's attention (FR-NOT-07). */
export function HomePage() {
  const { t } = useTranslation();
  const { user, warnings } = useMe();
  const staff = user.userType !== 'member';

  return (
    <>
      <PageTitle lead={t(`home.lead.${user.userType}`)}>
        {t('home.welcome', { name: user.fullName })}
      </PageTitle>

      {warnings.includes('fewer_than_two_super_admins') && (
        <div className="mb-6">
          <Alert tone="warning" title={t('home.fewerThanTwoTitle')}>
            {t('home.fewerThanTwoBody')}{' '}
            <Link to="/staff" className="font-medium underline">
              {t('home.addSuperAdmin')}
            </Link>
          </Alert>
        </div>
      )}

      {staff ? (
        <StaffToday superAdmin={user.userType === 'super_admin'} />
      ) : (
        // FR-SCH-03, FR-PUB-04: the panel, beside the home branch's hours, events and notices.
        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <MemberPanel />
          </div>
          <div className="min-w-0 space-y-6">
            {user.branchId !== null && <HoursCard branchId={user.branchId} />}
            <NoticeBoardView branchId={null} />
          </div>
        </div>
      )}
    </>
  );
}
