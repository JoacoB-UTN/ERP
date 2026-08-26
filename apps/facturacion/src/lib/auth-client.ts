'use client';

import { createAuthClient } from '@erp/auth-client';
import { DEFAULT_RUNTIME_PORTS, getBrowserOrigin, resolveServiceUrl } from '@erp/shared';

/**
 * Resolved at runtime from the current page's own host — see
 * docs/desktop-lan-architecture.md's "Runtime LAN addressing". Loading
 * Facturación from `192.168.1.50:3002` resolves this to
 * `192.168.1.50:3001` with zero rebuild; set `NEXT_PUBLIC_API_URL` to
 * override explicitly (dev/test only).
 */
const API_URL = resolveServiceUrl({
  explicitOverride: process.env.NEXT_PUBLIC_API_URL,
  port: DEFAULT_RUNTIME_PORTS.api,
  path: '/api/v1',
  currentOrigin: getBrowserOrigin(),
});

export const authClient = createAuthClient({
  baseUrl: API_URL,
  storageKeyPrefix: 'facturacion',
  onUnauthenticated: () => {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  },
});

export const {
  apiFetch,
  useMe,
  useLogin,
  useLogout,
  useLogoutAll,
  useChangePassword,
  useForgotPassword,
  useResetPassword,
  useCompanies,
  useActiveCompany,
  useActiveCompanyId,
  useBranches,
  useActiveBranch,
  useActiveBranchId,
  usePermissions,
  useActiveWarehouse,
  useActivePriceList,
  useCustomerLookup,
  useProductLookup,
  useInventoryLookup,
  usePriceLookup,
  useLookupPricesBatch,
  useSales,
  useSale,
  useCreateSale,
  useUpdateSale,
  useConfirmSale,
  useCancelSale,
  useRealtimeSync,
} = authClient;
