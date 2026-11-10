import {
  type ExportFormat,
  lostQuoteSchema,
  type SaveTariff,
  type Settlement,
  settlementBoardSchema,
  settlementSchema,
  tariffSchema,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, downloadFile } from './client';
import { errorMessage } from './errors';

/**
 * Under the loans key: declaring a copy lost ends a loan, and every settlement
 * step changes limits, panels and copies, so one refresh covers them all.
 */
export const SETTLEMENTS_KEY = ['loans', 'settlements'] as const;

/** FR-LST-10: each branch's open settlements, windows passed first. */
export function useSettlementBoard(branchId: number | null) {
  return useQuery({
    queryKey: [...SETTLEMENTS_KEY, 'board', branchId ?? 'all'],
    queryFn: () =>
      api(branchId === null ? '/settlements' : `/settlements?branchId=${branchId}`, {
        schema: settlementBoardSchema,
      }),
  });
}

export function useSettlement(id: number) {
  return useQuery({
    queryKey: [...SETTLEMENTS_KEY, 'one', id],
    queryFn: () => api(`/settlements/${id}`, { schema: settlementSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** FR-LST-13: every settlement a member has had (staff). */
export function useMemberSettlements(memberId: number, enabled = true) {
  return useQuery({
    queryKey: [...SETTLEMENTS_KEY, 'member', memberId],
    queryFn: () => api(`/members/${memberId}/settlements`, { schema: z.array(settlementSchema) }),
    enabled,
  });
}

export function useOwnSettlements(enabled: boolean) {
  return useQuery({
    queryKey: [...SETTLEMENTS_KEY, 'own'],
    queryFn: () => api('/me/settlements', { schema: z.array(settlementSchema) }),
    enabled,
  });
}

/** FR-LST-02: the tariff and window a declaration would set. */
export function useLostQuote(loanId: number, enabled: boolean) {
  return useQuery({
    queryKey: [...SETTLEMENTS_KEY, 'quote', loanId],
    queryFn: () => api(`/loans/${loanId}/lost`, { schema: lostQuoteSchema }),
    enabled,
  });
}

/** One step on a settlement; refreshes loans, copies, panels and the log. */
export function useSettlementStep(onDone?: (result: Settlement) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const step = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      settlementSchema.parse(await api(path, { method: 'POST', body: body ?? {} })),
    onSuccess: async (result) => {
      setError(null);
      await refreshAfterLoss(client);
      onDone?.(result);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  return { step, error, setError };
}

/** FR-LST-12: a missing copy is found; the settlement it closed or sits beside, if any. */
export function useCopyFound(onDone?: (settlement: Settlement | null) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const found = useMutation({
    mutationFn: async ({ copyId, reason }: { copyId: number; reason: string }) =>
      z
        .object({ settlement: settlementSchema.nullable() })
        .parse(await api(`/copies/${copyId}/found`, { method: 'POST', body: { reason } })),
    onSuccess: async (result) => {
      setError(null);
      await refreshAfterLoss(client);
      onDone?.(result.settlement);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  return { found, error };
}

async function refreshAfterLoss(client: ReturnType<typeof useQueryClient>) {
  await client.invalidateQueries({ queryKey: ['loans'] });
  await client.invalidateQueries({ queryKey: ['catalogue'] });
  await client.invalidateQueries({ queryKey: ['titles'] });
  await client.invalidateQueries({ queryKey: ['members'] });
  await client.invalidateQueries({ queryKey: ['dashboard'] });
  await client.invalidateQueries({ queryKey: ['log'] });
}

// ─── The tariff (FR-LST-16) ──────────────────────────────────────────────────

export function useTariff(branchId: number) {
  return useQuery({
    queryKey: ['tariff', branchId],
    queryFn: () => api(`/branches/${branchId}/tariff`, { schema: tariffSchema }),
    enabled: Number.isInteger(branchId) && branchId > 0,
  });
}

export function useSaveTariff(branchId: number, onDone?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveTariff) =>
      api(`/branches/${branchId}/tariff`, { method: 'PATCH', body, schema: tariffSchema }),
    onSuccess: async (saved) => {
      client.setQueryData(['tariff', branchId], saved);
      await client.invalidateQueries({ queryKey: ['log'] });
      onDone?.();
    },
  });
}

export function downloadTariff(branchId: number, format: ExportFormat): Promise<void> {
  return downloadFile(
    `/branches/${branchId}/tariff/export?format=${format}`,
    `lost-book-tariff.${format}`,
  );
}
