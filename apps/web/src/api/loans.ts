import { loanSchema, memberLoansSchema } from '@pothgula/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export const LOANS_KEY = ['loans'] as const;
export const memberLoansKey = (id: number) => ['loans', 'member', id] as const;
export const loanKey = (id: number) => ['loans', 'one', id] as const;
export const OWN_LOANS_KEY = ['loans', 'own'] as const;

/** FR-CIR-09, FR-CIR-15: a member's history and standing, for staff. */
export function useMemberLoans(id: number | null) {
  return useQuery({
    queryKey: memberLoansKey(id ?? 0),
    queryFn: () => api(`/members/${id}/loans`, { schema: memberLoansSchema }),
    enabled: id !== null && Number.isInteger(id) && id > 0,
  });
}

export function useLoan(id: number) {
  return useQuery({
    queryKey: loanKey(id),
    queryFn: () => api(`/loans/${id}`, { schema: loanSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** FR-CIR-04: the member's own books and late returns. */
export function useOwnLoans(enabled: boolean) {
  return useQuery({
    queryKey: OWN_LOANS_KEY,
    queryFn: () => api('/me/loans', { schema: memberLoansSchema }),
    enabled,
  });
}
