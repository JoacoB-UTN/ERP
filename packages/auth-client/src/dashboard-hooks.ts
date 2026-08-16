'use client';

import { useQuery } from '@tanstack/react-query';
import type { DashboardSummaryResponse } from '@erp/shared';
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

  return { useDashboardSummary };
}
