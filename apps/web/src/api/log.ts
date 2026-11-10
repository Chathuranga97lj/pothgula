import { type ExportFormat, type LogFilter, logPageSchema } from '@pothgula/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, downloadFile } from './client';

export const LOG_KEY = ['log'] as const;

/** The filter as a query string, leaving out the parts not set. */
export function logQuery(filter: LogFilter, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filter, ...extra })) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * §14: the log, newest first, a page at a time. Every new filter is a new read,
 * which the API writes to the log (FR-LOG-10); "show older" pages are not. So the
 * screens ask only when the person presses a button, never as they type.
 */
export function useLog(filter: LogFilter | null, limit = 50) {
  return useInfiniteQuery({
    queryKey: [...LOG_KEY, filter, limit],
    queryFn: ({ pageParam }) =>
      api(`/log${logQuery(filter ?? {}, { limit, ...(pageParam ? { before: pageParam } : {}) })}`, {
        schema: logPageSchema,
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: filter !== null,
    // A read is logged, so a page already fetched is not fetched again behind the scenes.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** FR-LOG-08: the same view as a file. */
export function downloadLog(filter: LogFilter, format: ExportFormat): Promise<void> {
  return downloadFile(`/log/export${logQuery(filter, { format })}`, `activity-log.${format}`);
}
