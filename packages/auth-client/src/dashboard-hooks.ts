'use client';

import { useQuery } from '@tanstack/react-query';
import { keepPreviousCompanyData } from './company-scoped-placeholder';
import type {
  DashboardSalesPeriod,
  DashboardSalesSeriesResponse,
  DashboardSummaryResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface DashboardClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

/**
 * See docs/dashboard.md. A single read-only aggregate call — every field
 * is independently nullable (the caller only sees what their own
 * permissions allow, see the backend's own doc comment); `null` must be
 * rendered as "not shown," never coerced to zero.
 */
export function createDashboardClient(config: DashboardClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function useDashboardSummary() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'dashboard', 'summary'],
      queryFn: () => apiFetch<DashboardSummaryResponse>('/dashboard/summary'),
      enabled: !!companyId,
    });
  }

  /**
   * The sales chart. Keyed by period so switching tabs reads a cached
   * window instead of refetching one already seen, and `placeholderData`
   * keeps the previous window's chart on screen while the next loads —
   * without it every tab click would blank the chart and shift the page.
   */
  function useDashboardSalesSeries(period: DashboardSalesPeriod) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'dashboard', 'sales-series', period],
      queryFn: () =>
        apiFetch<DashboardSalesSeriesResponse>(`/dashboard/sales-series?period=${period}`),
      enabled: !!companyId,
      // Same company only: switching company must not leave the previous
      // company's chart on screen — see company-scoped-placeholder.ts.
      placeholderData: keepPreviousCompanyData(companyId),
    });
  }

  return { useDashboardSummary, useDashboardSalesSeries };
}
