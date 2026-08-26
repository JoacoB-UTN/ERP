'use client';

import { createAuthClient } from '@erp/auth-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

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
