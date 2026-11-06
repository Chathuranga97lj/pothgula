import { branchSummarySchema, categorySchema, libraryInfoSchema } from '@pothgula/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client';

export const LIBRARY_KEY = ['library'] as const;
export const BRANCHES_KEY = ['branches'] as const;
export const CATEGORIES_KEY = ['categories'] as const;
export const branchKey = (id: number) => ['branches', id] as const;

/** The library's name and logo; public, so it works on the sign-in page too. */
export function useLibrary() {
  return useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => api('/library', { schema: libraryInfoSchema }),
    staleTime: 5 * 60_000,
  });
}

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: BRANCHES_KEY,
    queryFn: () => api('/branches', { schema: z.array(branchSummarySchema) }),
    enabled,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => api('/categories', { schema: z.array(categorySchema) }),
  });
}

/** Where an uploaded image is served from (NFR-16: only by our own API). */
export const imageUrl = (id: number, size: 'full' | 'thumb' = 'full') =>
  `/api/images/${id}${size === 'thumb' ? '?size=thumb' : ''}`;
