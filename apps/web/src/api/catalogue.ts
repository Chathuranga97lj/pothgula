import { catalogueResponseSchema, similarTitleSchema, titleDetailSchema } from '@pothgula/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from './client';

export const CATALOGUE_KEY = ['catalogue'] as const;
export const titleKey = (id: number) => ['titles', id] as const;

export interface CatalogueQuery {
  q: string;
  branchId: number | null;
  category: string;
  available: boolean;
  page: number;
}

export function useCatalogue(query: CatalogueQuery, enabled = true) {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.branchId) params.set('branchId', String(query.branchId));
  if (query.category) params.set('category', query.category);
  if (query.available) params.set('available', 'true');
  if (query.page) params.set('page', String(query.page));
  const qs = params.toString();
  return useQuery({
    queryKey: [...CATALOGUE_KEY, qs],
    queryFn: () => api(`/catalogue${qs ? `?${qs}` : ''}`, { schema: catalogueResponseSchema }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTitle(id: number) {
  return useQuery({
    queryKey: titleKey(id),
    queryFn: () => api(`/titles/${id}`, { schema: titleDetailSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** FR-CAT-01: titles that may already be catalogued, while a new one is typed. */
export function useSimilarTitles(title: string, isbn: string) {
  const [debounced, setDebounced] = useState({ title, isbn });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ title, isbn }), 350);
    return () => clearTimeout(timer);
  }, [title, isbn]);
  const params = new URLSearchParams({
    title: debounced.title.trim(),
    isbn: debounced.isbn.trim(),
  });
  return useQuery({
    queryKey: ['titles', 'similar', params.toString()],
    queryFn: () => api(`/titles/similar?${params}`, { schema: z.array(similarTitleSchema) }),
    enabled: debounced.title.trim().length >= 3 || debounced.isbn.trim().length >= 10,
  });
}

/** Waits until typing pauses before searching. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}
