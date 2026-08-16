'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
  WarehousesResponse,
  WarehouseDetailResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface WarehousesClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

/**
 * Warehouse master-data hooks — see docs/inventory.md. Separate from
 * inventory-hooks.ts (stock/movements/adjustments) because warehouses are
 * master data with their own CRUD lifecycle, same split as the backend's
 * WarehousesModule vs InventoryModule.
 */
export function createWarehousesClient(config: WarehousesClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateWarehouses(
    queryClient: ReturnType<typeof useQueryClient>,
    companyId: string | null,
    id?: string,
  ) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'warehouses', 'list'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'warehouses', 'detail', id] });
    }
  }

  function useWarehouses() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'warehouses', 'list'],
      queryFn: () => apiFetch<WarehousesResponse>('/warehouses'),
      enabled: !!companyId,
    });
  }

  function useWarehouse(id: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'warehouses', 'detail', id],
      queryFn: () => apiFetch<WarehouseDetailResponse>(`/warehouses/${id}`),
      enabled: !!companyId && !!id,
    });
  }

  function useCreateWarehouse() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateWarehouseInput) =>
        apiFetch<WarehouseDetailResponse>('/warehouses', { json: input }),
      onSuccess: () => invalidateWarehouses(queryClient, companyId),
    });
  }

  function useUpdateWarehouse() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateWarehouseInput }) =>
        apiFetch<WarehouseDetailResponse>(`/warehouses/${id}`, { method: 'PATCH', json: input }),
      onSuccess: (_data, variables) => invalidateWarehouses(queryClient, companyId, variables.id),
    });
  }

  function useDeactivateWarehouse() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<WarehouseDetailResponse>(`/warehouses/${id}/deactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateWarehouses(queryClient, companyId, id),
    });
  }

  function useReactivateWarehouse() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<WarehouseDetailResponse>(`/warehouses/${id}/reactivate`, { method: 'POST' }),
      onSuccess: (_data, id) => invalidateWarehouses(queryClient, companyId, id),
    });
  }

  return {
    useWarehouses,
    useWarehouse,
    useCreateWarehouse,
    useUpdateWarehouse,
    useDeactivateWarehouse,
    useReactivateWarehouse,
  };
}
