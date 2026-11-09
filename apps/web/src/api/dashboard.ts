import { dueListsSchema, memberDashboardSchema, staffDashboardSchema } from '@pothgula/shared';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from './client';

// Under the loans key, so issuing or taking back at the counter refreshes them.
export const STAFF_DASHBOARD_KEY = ['loans', 'dashboard'] as const;
export const dueKey = (branchId: number | null) => ['loans', 'due', branchId ?? 'all'] as const;
export const MEMBER_DASHBOARD_KEY = ['loans', 'me-dashboard'] as const;

/** FR-NOT-03, FR-NOT-09: today's work, per branch. */
export function useStaffDashboard(enabled: boolean) {
  return useQuery({
    queryKey: STAFF_DASHBOARD_KEY,
    queryFn: () => api('/dashboard', { schema: staffDashboardSchema }),
    enabled,
  });
}

/** FR-NOT-04, FR-NOT-12: overdue, the five-day list and today's late returns. */
export function useDueLists(branchId: number | null) {
  return useQuery({
    queryKey: dueKey(branchId),
    queryFn: () =>
      api(branchId === null ? '/due' : `/due?branchId=${branchId}`, { schema: dueListsSchema }),
  });
}

/** FR-NOT-01, FR-NOT-02, FR-NOT-08: the member's own panel. */
export function useMemberDashboard(enabled: boolean) {
  return useQuery({
    queryKey: MEMBER_DASHBOARD_KEY,
    queryFn: () => api('/me/dashboard', { schema: memberDashboardSchema }),
    enabled,
  });
}

export type Sheet = 'daily-loans' | 'call-list';

/** FR-RPT-16, FR-NOT-04: a branch's sheet as a PDF to print. */
export function downloadSheet(sheet: Sheet, branchId: number): Promise<void> {
  return downloadFile(`/sheets/${sheet}?branchId=${branchId}`, `${sheet}.pdf`);
}
