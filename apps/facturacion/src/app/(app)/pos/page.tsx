'use client';

import { usePermissions } from '@/lib/auth-client';
import { PosWorkspace } from '@/components/pos/pos-workspace';

export default function PosPage() {
  const { can, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!can('sales.documents.create')) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para iniciar una venta en POS.</p>;
  }
  return <PosWorkspace />;
}
