'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { AuditListResponse, AuditDetailResponse } from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface AuditClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

export interface AuditListFilters {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

function buildAuditQueryString(filters: AuditListFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Read-only audit trail hooks — used today only by Gestión's
 * /administracion/auditoria (see CLAUDE.md: audit administration belongs
 * to Gestión, not Facturación). Kept in the shared package for the same
 * reason as createAdministrationClient: this is domain logic, not UI.
 */
export function createAuditClient(config: AuditClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function useAuditLog(filters: AuditListFilters) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'audit', filters],
      queryFn: () =>
        apiFetch<AuditListResponse>(`/administration/audit${buildAuditQueryString(filters)}`),
      enabled: !!companyId,
      // Keeps the previous page's rows on screen while the next page
      // loads, instead of a full-list loading flash on every click.
      placeholderData: keepPreviousData,
    });
  }

  function useAuditLogDetail(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'audit', 'detail', id],
      queryFn: () => apiFetch<AuditDetailResponse>(`/administration/audit/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  return { useAuditLog, useAuditLogDetail };
}
