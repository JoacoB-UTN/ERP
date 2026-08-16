'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatMoney, salesDocumentStatusLabel, type SalesListQuery } from '@erp/shared';
import { usePermissions, useSales, useWarehouses } from '@/lib/auth-client';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';

const PAGE_SIZE = 25;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

function statusClassName(status: string): string {
  if (status === 'CONFIRMED') return 'text-emerald-600';
  if (status === 'CANCELLED') return 'text-muted-foreground';
  return 'text-amber-600';
}

export default function VentasPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const warehousesQuery = useWarehouses();

  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const salesQuery = useSales({
    search: search.trim() || undefined,
    warehouseId: warehouseId || undefined,
    status: (status || undefined) as SalesListQuery['status'],
    page,
    pageSize: PAGE_SIZE,
  });

  if (permissionsLoading) {
    return null;
  }
  if (!can('sales.documents.read')) {
    return <Unauthorized />;
  }

  const canCreate = can('sales.documents.create');
  const items = salesQuery.data?.items ?? [];
  const pagination = salesQuery.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground">
            Ventas internas — el flujo comercial completo desde el cliente hasta el descuento de stock.
          </p>
        </div>
        {canCreate && (
          <Link href="/ventas/nueva" className={buttonVariants()}>
            <Plus className="size-4" />
            Nueva venta
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por número o cliente…"
          className="max-w-64"
          aria-label="Buscar"
        />
        <Select
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
          className="max-w-48"
          aria-label="Depósito"
        >
          <option value="">Todos los depósitos</option>
          {warehousesQuery.data?.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="max-w-40"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borrador</option>
          <option value="CONFIRMED">Confirmada</option>
          <option value="CANCELLED">Cancelada</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Depósito</th>
              <th className="px-4 py-2">Lista</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link href={`/ventas/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                    {s.number}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDate(s.occurredAt)}</td>
                <td className="px-4 py-2">{s.customer.legalName}</td>
                <td className="px-4 py-2 whitespace-nowrap">{s.warehouse.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{s.priceList.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.total, s.currencyCode)}</td>
                <td className={`px-4 py-2 ${statusClassName(s.status)}`}>{salesDocumentStatusLabel(s.status)}</td>
              </tr>
            ))}
            {!salesQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay ventas registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {totalPages} — {pagination.total} venta{pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
