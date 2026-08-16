'use client';

import { useParams } from 'next/navigation';
import { usePermissions } from '@/lib/auth-client';
import { SaleWorkspace } from '@/components/ventas/sale-workspace';

export default function VentaPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!can('sales.documents.read')) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver ventas.</p>;
  }
  return <SaleWorkspace saleId={id ?? null} />;
}
