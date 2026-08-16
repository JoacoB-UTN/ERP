'use client';

import { usePermissions } from '@/lib/auth-client';
import { SaleWorkspace } from '@/components/ventas/sale-workspace';

export default function NuevaVentaPage() {
  const { can, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!can('sales.documents.create')) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para crear ventas.</p>;
  }
  return <SaleWorkspace saleId={null} />;
}
