'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  CustomerDocumentType,
  CustomerTaxCondition,
  customerDocumentTypeLabel,
  customerTaxConditionLabel,
  type SupplierDetail,
} from '@erp/shared';
import { usePermissions, useSupplier, useUpdateSupplier } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { supplierFieldErrors } from '@/components/compras/purchases-errors';

export default function EditarProveedorPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const supplierQuery = useSupplier(id ?? null);

  if (permissionsLoading || supplierQuery.isLoading) {
    return null;
  }
  if (!can('purchases.suppliers.update') || !supplierQuery.data) {
    return <Unauthorized />;
  }

  return <EditarProveedorForm supplier={supplierQuery.data.supplier} />;
}

function EditarProveedorForm({ supplier }: { supplier: SupplierDetail }) {
  const router = useRouter();
  const updateSupplier = useUpdateSupplier();

  const [legalName, setLegalName] = useState(supplier.legalName);
  const [tradeName, setTradeName] = useState(supplier.tradeName ?? '');
  const [documentType, setDocumentType] = useState(supplier.documentType ?? '');
  const [taxId, setTaxId] = useState(supplier.taxId ?? '');
  const [taxCondition, setTaxCondition] = useState(supplier.taxCondition ?? '');
  const [email, setEmail] = useState(supplier.email ?? '');
  const [phone, setPhone] = useState(supplier.phone ?? '');
  const [address, setAddress] = useState(supplier.address ?? '');
  const [city, setCity] = useState(supplier.city ?? '');
  const [province, setProvince] = useState(supplier.province ?? '');
  const [postalCode, setPostalCode] = useState(supplier.postalCode ?? '');
  const [notes, setNotes] = useState(supplier.notes ?? '');
  const [fieldErrors, setFieldErrors] = useState<{ general?: string; taxId?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      await updateSupplier.mutateAsync({
        id: supplier.id,
        input: {
          legalName,
          tradeName: tradeName || null,
          documentType: (documentType || null) as CustomerDocumentType | null,
          taxId: taxId || null,
          taxCondition: (taxCondition || null) as CustomerTaxCondition | null,
          email: email || null,
          phone: phone || null,
          address: address || null,
          city: city || null,
          province: province || null,
          postalCode: postalCode || null,
          notes: notes || null,
        },
      });
      router.push(`/compras/proveedores/${supplier.id}`);
    } catch (err) {
      setFieldErrors(supplierFieldErrors(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <PageHeader
        title={`Editar ${supplier.displayName}`}
        backHref={`/compras/proveedores/${supplier.id}`}
        backLabel={supplier.displayName}
      />

      <div className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="legalName">Razón social / Nombre</Label>
          <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} required autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tradeName">Nombre comercial</Label>
          <Input id="tradeName" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="documentType">Tipo de documento</Label>
          <Select id="documentType" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            <option value="">Sin especificar</option>
            {Object.values(CustomerDocumentType).map((value) => (
              <option key={value} value={value}>
                {customerDocumentTypeLabel(value)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxId">CUIT / Documento</Label>
          <Input
            id="taxId"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="30-12345678-9"
            aria-invalid={!!fieldErrors.taxId}
          />
          <FieldError message={fieldErrors.taxId} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxCondition">Condición frente al IVA</Label>
          <Select id="taxCondition" value={taxCondition} onChange={(e) => setTaxCondition(e.target.value)}>
            <option value="">Sin especificar</option>
            {Object.values(CustomerTaxCondition).map((value) => (
              <option key={value} value={value}>
                {customerTaxConditionLabel(value)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="address">Domicilio</Label>
          <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="city">Ciudad</Label>
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="province">Provincia</Label>
          <Input id="province" value={province} onChange={(e) => setProvince(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="postalCode">Código postal</Label>
          <Input id="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </div>

      {fieldErrors.general && (
        <p role="alert" className="text-sm text-destructive">
          {fieldErrors.general}
        </p>
      )}

      <div>
        <Button type="submit" disabled={updateSupplier.isPending}>
          {updateSupplier.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
