'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Power, PowerOff } from 'lucide-react';
import { customerDocumentTypeLabel, customerTaxConditionLabel, supplierStatusLabel } from '@erp/shared';
import { usePermissions, useSupplier, useDeactivateSupplier, useReactivateSupplier } from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

export default function ProveedorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const supplierQuery = useSupplier(id ?? null);
  const deactivate = useDeactivateSupplier();
  const reactivate = useReactivateSupplier();

  if (permissionsLoading || supplierQuery.isLoading) {
    return null;
  }
  if (!can('purchases.suppliers.read')) {
    return <Unauthorized />;
  }
  const supplier = supplierQuery.data?.supplier;
  if (!supplier) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/compras/proveedores"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Volver a proveedores
        </Link>
        <p className="text-muted-foreground">No se encontró el proveedor.</p>
      </div>
    );
  }

  const canUpdate = can('purchases.suppliers.update');
  const canDeactivate = can('purchases.suppliers.deactivate');

  async function handleToggleStatus() {
    if (!supplier) return;
    if (supplier.status === 'ACTIVE') {
      if (!window.confirm(`¿Desactivar el proveedor "${supplier.displayName}"?`)) return;
      await deactivate.mutateAsync(supplier.id);
    } else {
      await reactivate.mutateAsync(supplier.id);
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {supplier.displayName}
            <StatusBadge status={supplier.status}>{supplierStatusLabel(supplier.status)}</StatusBadge>
          </span>
        }
        description={
          <>
            {supplier.code}
            {supplier.tradeName && ` · ${supplier.legalName}`}
            {supplier.taxIdFormatted && ` · CUIT/Doc. ${supplier.taxIdFormatted}`}
          </>
        }
        backHref="/compras/proveedores"
        backLabel="Proveedores"
        actions={
          <>
            {canUpdate && (
              <Link href={`/compras/proveedores/${supplier.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
                <Pencil className="size-4" />
                Editar
              </Link>
            )}
            {canDeactivate && (
              <Button type="button" variant="outline" onClick={handleToggleStatus}>
                {supplier.status === 'ACTIVE' ? (
                  <>
                    <PowerOff className="size-4" />
                    Desactivar
                  </>
                ) : (
                  <>
                    <Power className="size-4" />
                    Reactivar
                  </>
                )}
              </Button>
            )}
          </>
        }
      />

      <div className="rounded-md border border-border bg-card p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Tipo de documento</dt>
            <dd className="mt-0.5">{supplier.documentType ? customerDocumentTypeLabel(supplier.documentType) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Condición frente al IVA</dt>
            <dd className="mt-0.5">{supplier.taxCondition ? customerTaxConditionLabel(supplier.taxCondition) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Email</dt>
            <dd className="mt-0.5">{supplier.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Teléfono</dt>
            <dd className="mt-0.5">{supplier.phone ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Domicilio</dt>
            <dd className="mt-0.5">
              {[supplier.address, supplier.city, supplier.province, supplier.postalCode]
                .filter(Boolean)
                .join(', ') || '—'}
            </dd>
          </div>
          {supplier.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notas</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{supplier.notes}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
