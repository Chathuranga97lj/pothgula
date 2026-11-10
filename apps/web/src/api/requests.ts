import {
  type BookRequest,
  bookRequestDetailSchema,
  bookRequestSchema,
  requestBoardSchema,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, downloadFile } from './client';
import { errorMessage } from './errors';

/**
 * Under the loans key: a request's steps change copies, loans and both
 * dashboards, so one refresh covers them all.
 */
export const REQUESTS_KEY = ['loans', 'requests'] as const;

/** FR-REQ-09: each branch's requests, by what needs doing. */
export function useRequestBoard(branchId: number | null) {
  return useQuery({
    queryKey: [...REQUESTS_KEY, 'board', branchId ?? 'all'],
    queryFn: () =>
      api(branchId === null ? '/requests' : `/requests?branchId=${branchId}`, {
        schema: requestBoardSchema,
      }),
  });
}

/** FR-REQ-03: one request with its member in full. */
export function useRequestDetail(id: number) {
  return useQuery({
    queryKey: [...REQUESTS_KEY, 'one', id],
    queryFn: () => api(`/requests/${id}`, { schema: bookRequestDetailSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useOwnRequests(enabled: boolean) {
  return useQuery({
    queryKey: [...REQUESTS_KEY, 'own'],
    queryFn: () => api('/me/requests', { schema: z.array(bookRequestSchema) }),
    enabled,
  });
}

/** One step of a request; refreshes everything that depends on where copies are. */
export function useRequestStep(onDone?: (result: BookRequest[]) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const step = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => {
      const result = await api(path, { method: 'POST', body: body ?? {} });
      return z.union([bookRequestSchema, z.array(bookRequestSchema)]).parse(result);
    },
    onSuccess: async (result) => {
      setError(null);
      await client.invalidateQueries({ queryKey: ['loans'] });
      await client.invalidateQueries({ queryKey: ['catalogue'] });
      await client.invalidateQueries({ queryKey: ['titles'] });
      await client.invalidateQueries({ queryKey: ['log'] });
      onDone?.(Array.isArray(result) ? result : [result]);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  return { step, error, setError };
}

/** FR-REQ-13: the slip that travels with the books just sent. */
export function downloadTransitSlip(ids: number[]): Promise<void> {
  return downloadFile(`/requests/slip?ids=${ids.join(',')}`, 'transit-slip.pdf');
}
