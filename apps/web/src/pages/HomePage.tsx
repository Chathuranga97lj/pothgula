import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMe } from '../auth/auth';
import { Alert, Card, PageTitle } from '../components/ui';

export function HomePage() {
  const { t } = useTranslation();
  const { user, warnings } = useMe();

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

      {user.status === 'pending' && (
        <div className="mb-6">
          <Alert tone="info" title={t('home.pendingTitle')}>
            {t('home.pendingBody')}{' '}
            <Link to="/my-membership" className="font-medium underline">
              {t('home.pendingLink')}
            </Link>
          </Alert>
        </div>
      )}

      <Card>
        <h2 className="mb-2 font-semibold">{t('home.comingTitle')}</h2>
        <p className="text-stone-700">{t('home.comingBody')}</p>
      </Card>
    </>
  );
}
