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
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { LoanPage } from './pages/LoanPage';
import { MemberPage } from './pages/MemberPage';
import { MembersPage } from './pages/MembersPage';
import { MyMembershipPage } from './pages/MyMembershipPage';
import { NewTitlePage } from './pages/NewTitlePage';
import { RegisterMemberPage } from './pages/RegisterMemberPage';
import { SignInPage } from './pages/SignInPage';
import { StaffPage } from './pages/StaffPage';
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
