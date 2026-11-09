import {
  type MemberDetail,
  memberDetailSchema,
  memberSummarySchema,
  membershipOverviewSchema,
} from '@pothgula/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api, downloadFile } from './client';

export const MEMBERS_KEY = ['members'] as const;
export const memberKey = (id: number) => ['members', 'one', id] as const;
export const OWN_MEMBERSHIP_KEY = ['me', 'membership'] as const;

export function useApplications(status: 'pending' | 'rejected') {
  return useQuery({
    queryKey: [...MEMBERS_KEY, 'applications', status],
    queryFn: () => api(`/applications?status=${status}`, { schema: z.array(memberSummarySchema) }),
  });
}

export function useMemberSearch(q: string) {
  return useQuery({
    queryKey: [...MEMBERS_KEY, 'search', q],
    queryFn: () =>
      api(`/members?q=${encodeURIComponent(q)}`, { schema: z.array(memberSummarySchema) }),
    enabled: q.trim().length >= 2,
  });
}

export function useMembershipOverview() {
  return useQuery({
    queryKey: [...MEMBERS_KEY, 'overview'],
    queryFn: () => api('/members/overview', { schema: membershipOverviewSchema }),
  });
}

export function useMember(id: number) {
  return useQuery({
    queryKey: memberKey(id),
    queryFn: () => api(`/members/${id}`, { schema: memberDetailSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useOwnMembership(enabled: boolean) {
  return useQuery<MemberDetail>({
    queryKey: OWN_MEMBERSHIP_KEY,
    queryFn: () => api('/me/membership', { schema: memberDetailSchema }),
    enabled,
  });
}

/**
 * Downloads an export (FR-AUT-19). It needs the session token, so it is fetched
 * and handed to the browser as a file, rather than opened as a plain link.
 */
export function downloadMemberExport(id: number, format: 'txt' | 'pdf'): Promise<void> {
  return downloadFile(`/members/${id}/export?format=${format}`, `member-${id}.${format}`);
}
