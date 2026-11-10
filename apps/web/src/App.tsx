import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequireRole } from './auth/guards';
import { Layout } from './components/Layout';
import { ApplyPage } from './pages/ApplyPage';
import { BranchesPage } from './pages/BranchesPage';
import { BranchPage } from './pages/BranchPage';
import { CataloguePage } from './pages/CataloguePage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { CounterPage } from './pages/CounterPage';
import { CallListPage, DuePage } from './pages/DuePage';
import { ExtensionsPage } from './pages/ExtensionsPage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { LoanPage } from './pages/LoanPage';
import { LogPage } from './pages/LogPage';
import { MemberPage } from './pages/MemberPage';
import { MembersPage } from './pages/MembersPage';
import { MyMembershipPage } from './pages/MyMembershipPage';
import { NewTitlePage } from './pages/NewTitlePage';
import { RegisterMemberPage } from './pages/RegisterMemberPage';
import { ReportPage, ReportsPage } from './pages/ReportsPage';
import { RequestPage } from './pages/RequestPage';
import { ManageNoticesPage, NoticeEditPage, NoticePage, NoticesPage } from './pages/NoticesPage';
import { RequestsPage } from './pages/RequestsPage';
import { SettlementPage } from './pages/SettlementPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { SignInPage } from './pages/SignInPage';
import { StaffPage } from './pages/StaffPage';
import { TariffPage } from './pages/TariffPage';
import { TitlePage } from './pages/TitlePage';

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/apply" element={<ApplyPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="change-password" element={<ChangePasswordPage />} />
          <Route path="catalogue" element={<CataloguePage />} />
          <Route
            path="titles/new"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <NewTitlePage />
              </RequireRole>
            }
          />
          <Route
            path="catalogue/import"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <ImportPage />
              </RequireRole>
            }
          />
          <Route path="titles/:id" element={<TitlePage />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route
            path="notices/manage"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <ManageNoticesPage />
              </RequireRole>
            }
          />
          <Route
            path="notices/new"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <NoticeEditPage />
              </RequireRole>
            }
          />
          <Route
            path="notices/:id/edit"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <NoticeEditPage />
              </RequireRole>
            }
          />
          <Route path="notices/:id" element={<NoticePage />} />
          <Route
            path="my-membership"
            element={
              <RequireRole roles={['member']}>
                <MyMembershipPage />
              </RequireRole>
            }
          />
          <Route
            path="counter"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <CounterPage />
              </RequireRole>
            }
          />
          <Route
            path="due"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <DuePage />
              </RequireRole>
            }
          />
          <Route
            path="due/calls"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <CallListPage />
              </RequireRole>
            }
          />
          <Route
            path="requests"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <RequestsPage />
              </RequireRole>
            }
          />
          <Route
            path="requests/:id"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <RequestPage />
              </RequireRole>
            }
          />
          <Route
            path="lost-books"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <SettlementsPage />
              </RequireRole>
            }
          />
          <Route
            path="lost-books/tariff/:branchId"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <TariffPage />
              </RequireRole>
            }
          />
          <Route
            path="lost-books/:id"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <SettlementPage />
              </RequireRole>
            }
          />
          <Route
            path="extensions"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <ExtensionsPage />
              </RequireRole>
            }
          />
          <Route
            path="loans/:id"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <LoanPage />
              </RequireRole>
            }
          />
          <Route
            path="members"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <MembersPage />
              </RequireRole>
            }
          />
          <Route
            path="members/new"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <RegisterMemberPage />
              </RequireRole>
            }
          />
          <Route
            path="members/:id"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <MemberPage />
              </RequireRole>
            }
          />
          <Route
            path="branches"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <BranchesPage />
              </RequireRole>
            }
          />
          <Route
            path="branches/:id"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <BranchPage />
              </RequireRole>
            }
          />
          <Route
            path="categories"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <CategoriesPage />
              </RequireRole>
            }
          />
          <Route
            path="reports"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <ReportsPage />
              </RequireRole>
            }
          />
          <Route
            path="reports/:kind"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <ReportPage />
              </RequireRole>
            }
          />
          <Route
            path="log"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <LogPage />
              </RequireRole>
            }
          />
          <Route
            path="staff"
            element={
              <RequireRole roles={['admin', 'super_admin']}>
                <StaffPage />
              </RequireRole>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
