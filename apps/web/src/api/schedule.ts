import {
  type AddClosure,
  branchHoursSchema,
  type Notice,
  type NoticeInput,
  noticeBoardSchema,
  noticeSchema,
  type SaveWeek,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client';

// ─── Opening hours (§11) ─────────────────────────────────────────────────────

export const hoursKey = (branchId: number) => ['hours', branchId] as const;

/** FR-SCH-03, FR-SCH-04: any branch's hours and today's status. */
export function useHours(branchId: number | null) {
  return useQuery({
    queryKey: hoursKey(branchId ?? 0),
    queryFn: () => api(`/branches/${branchId}/hours`, { schema: branchHoursSchema }),
    enabled: branchId !== null && branchId > 0,
  });
}

/** FR-SCH-01, FR-SCH-02, FR-SCH-05: changing hours or closures; the new hours come back. */
export function useHoursChange(branchId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      change:
        | { kind: 'week'; body: SaveWeek }
        | { kind: 'close'; body: AddClosure }
        | { kind: 'reopen'; closureId: number },
    ) =>
      change.kind === 'week'
        ? api(`/branches/${branchId}/hours`, {
            method: 'PATCH',
            body: change.body,
            schema: branchHoursSchema,
          })
        : change.kind === 'close'
          ? api(`/branches/${branchId}/closures`, {
              method: 'POST',
              body: change.body,
              schema: branchHoursSchema,
            })
          : api(`/closures/${change.closureId}/withdraw`, {
              method: 'POST',
              schema: branchHoursSchema,
            }),
    onSuccess: async (hours) => {
      client.setQueryData(hoursKey(branchId), hours);
      await client.invalidateQueries({ queryKey: ['loans', 'me-dashboard'] });
      await client.invalidateQueries({ queryKey: ['log'] });
    },
  });
}

// ─── Notices and events (§12) ────────────────────────────────────────────────

export const NOTICES_KEY = ['notices'] as const;

/** FR-PUB-04: what a branch's members see; the caller's own branch when none is given. */
export function useNoticeBoard(branchId: number | null) {
  return useQuery({
    queryKey: [...NOTICES_KEY, 'board', branchId ?? 'own'],
    queryFn: () =>
      api(branchId === null ? '/notices' : `/notices?branchId=${branchId}`, {
        schema: noticeBoardSchema,
      }),
  });
}

/** Opening one; for a member, an important one then leaves their panel (FR-PUB-07). */
export function useNotice(id: number) {
  return useQuery({
    queryKey: [...NOTICES_KEY, 'one', id],
    queryFn: () => api(`/notices/${id}`, { schema: noticeSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useManagedNotices(branchId: number | null) {
  return useQuery({
    queryKey: [...NOTICES_KEY, 'manage', branchId ?? 'mine'],
    queryFn: () =>
      api(branchId === null ? '/notices/manage' : `/notices/manage?branchId=${branchId}`, {
        schema: z.array(noticeSchema),
      }),
  });
}

/** Publish, edit, withdraw, restore, or change the picture; refreshes every notice list. */
export function useNoticeChange(onDone?: (n: Notice) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      change:
        | { kind: 'create'; body: NoticeInput }
        | { kind: 'update'; id: number; body: NoticeInput }
        | { kind: 'withdraw' | 'restore' | 'removeImage'; id: number }
        | { kind: 'image'; id: number; form: FormData },
    ) => {
      switch (change.kind) {
        case 'create':
          return api('/notices', { method: 'POST', body: change.body, schema: noticeSchema });
        case 'update':
          return api(`/notices/${change.id}`, {
            method: 'PATCH',
            body: change.body,
            schema: noticeSchema,
          });
        case 'image':
          return api(`/notices/${change.id}/image`, {
            method: 'POST',
            body: change.form,
            schema: noticeSchema,
          });
        case 'removeImage':
          return api(`/notices/${change.id}/image/remove`, {
            method: 'POST',
            schema: noticeSchema,
          });
        default:
          return api(`/notices/${change.id}/${change.kind}`, {
            method: 'POST',
            schema: noticeSchema,
          });
      }
    },
    onSuccess: async (n) => {
      client.setQueryData([...NOTICES_KEY, 'one', n.id], n);
      await client.invalidateQueries({ queryKey: NOTICES_KEY });
      await client.invalidateQueries({ queryKey: ['log'] });
      onDone?.(n);
    },
  });
}
