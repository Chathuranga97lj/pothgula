import { type ExportFormat, type ReportKind, reportSchema } from '@pothgula/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, downloadFile } from './client';

/** Under the loans key, so issuing or taking back refreshes the figures. */
export const reportKey = (kind: ReportKind, query: string) =>
  ['loans', 'report', kind, query] as const;

/** §15: one report, for the choices in `query` (a query string without the `?`). */
export function useReport(kind: ReportKind, query: string) {
  return useQuery({
    queryKey: reportKey(kind, query),
    queryFn: () => api(`/reports/${kind}${query ? `?${query}` : ''}`, { schema: reportSchema }),
    placeholderData: keepPreviousData,
  });
}

/** FR-RPT-09: the same report as a file. */
export function downloadReport(kind: ReportKind, query: string, format: ExportFormat) {
  const params = new URLSearchParams(query);
  params.set('format', format);
  return downloadFile(`/reports/${kind}/export?${params.toString()}`, `report-${kind}.${format}`);
}
