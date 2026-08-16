'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateRoleInput,
  UpdateRoleInput,
  RolesResponse,
  RoleDetailResponse,
  PermissionsCatalogResponse,
  CompanyUsersResponse,
  UserRolesResponse,
} from '@erp/shared';
import type { ApiFetchOptions } from './api-client';

interface AdministrationClientConfig {
  apiFetch: <T>(path: string, options?: ApiFetchOptions) => Promise<T>;
  useActiveCompanyId: () => string | null;
}

/**
 * Roles/permissions/user-administration hooks — used today only by
 * Gestión's /administracion pages, but kept in the shared package (not
 * app-local) per CLAUDE.md: this is domain logic, not UI, and duplicating
 * it into a second app later would violate "never duplicate business
 * logic between Gestión and Facturación."
 */
export function createAdministrationClient(config: AdministrationClientConfig) {
  const { apiFetch, useActiveCompanyId } = config;

  function invalidateAfterRoleChange(queryClient: QueryClient, companyId: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'roles'] });
    // A role/permission edit can change the CURRENT user's own effective
    // permissions (e.g. editing the role they're using right now) — see
    // CLAUDE.md section on refreshing permissions after changes.
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'permissions'] });
  }

  function invalidateAfterAssignmentChange(
    queryClient: QueryClient,
    companyId: string | null,
    userId: string,
  ) {
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'users', userId, 'roles'] });
    void queryClient.invalidateQueries({ queryKey: ['company', companyId, 'permissions'] });
  }

  function useRoles() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'roles'],
      queryFn: () => apiFetch<RolesResponse>('/administration/roles'),
      enabled: !!companyId,
    });
  }

  function useRole(roleId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'roles', roleId],
      queryFn: () => apiFetch<RoleDetailResponse>(`/administration/roles/${roleId}`),
      enabled: !!companyId && !!roleId,
    });
  }

  function usePermissionCatalog() {
    return useQuery({
      queryKey: ['administration-permission-catalog'],
      queryFn: () => apiFetch<PermissionsCatalogResponse>('/administration/permissions'),
      staleTime: Infinity, // platform-defined, effectively static per running server
    });
  }

  function useCreateRole() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (input: CreateRoleInput) =>
        apiFetch<RoleDetailResponse>('/administration/roles', { json: input }),
      onSuccess: () => invalidateAfterRoleChange(queryClient, companyId),
    });
  }

  function useUpdateRole() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ roleId, input }: { roleId: string; input: UpdateRoleInput }) =>
        apiFetch<RoleDetailResponse>(`/administration/roles/${roleId}`, {
          method: 'PATCH',
          json: input,
        }),
      onSuccess: () => invalidateAfterRoleChange(queryClient, companyId),
    });
  }

  function useDeleteRole() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: (roleId: string) =>
        apiFetch<RoleDetailResponse>(`/administration/roles/${roleId}`, { method: 'DELETE' }),
      onSuccess: () => invalidateAfterRoleChange(queryClient, companyId),
    });
  }

  function useReplaceRolePermissions() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ roleId, permissionCodes }: { roleId: string; permissionCodes: string[] }) =>
        apiFetch<RoleDetailResponse>(`/administration/roles/${roleId}/permissions`, {
          method: 'PUT',
          json: { permissionCodes },
        }),
      onSuccess: () => invalidateAfterRoleChange(queryClient, companyId),
    });
  }

  function useCompanyUsers() {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'users'],
      queryFn: () => apiFetch<CompanyUsersResponse>('/administration/users'),
      enabled: !!companyId,
    });
  }

  function useUserRoles(userId: string | null) {
    const companyId = useActiveCompanyId();
    return useQuery({
      queryKey: ['company', companyId, 'users', userId, 'roles'],
      queryFn: () => apiFetch<UserRolesResponse>(`/administration/users/${userId}/roles`),
      enabled: !!companyId && !!userId,
    });
  }

  function useAssignRole() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
        apiFetch<RoleDetailResponse>(`/administration/users/${userId}/roles`, {
          json: { roleId },
        }),
      onSuccess: (_data, variables) =>
        invalidateAfterAssignmentChange(queryClient, companyId, variables.userId),
    });
  }

  function useRemoveRoleAssignment() {
    const queryClient = useQueryClient();
    const companyId = useActiveCompanyId();
    return useMutation({
      mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
        apiFetch<{ ok: true }>(`/administration/users/${userId}/roles/${roleId}`, {
          method: 'DELETE',
        }),
      onSuccess: (_data, variables) =>
        invalidateAfterAssignmentChange(queryClient, companyId, variables.userId),
    });
  }

  return {
    useRoles,
    useRole,
    usePermissionCatalog,
    useCreateRole,
    useUpdateRole,
    useDeleteRole,
    useReplaceRolePermissions,
    useCompanyUsers,
    useUserRoles,
    useAssignRole,
    useRemoveRoleAssignment,
  };
}
