'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CustomerDocumentType,
  CustomerTaxCondition,
  customerDocumentTypeLabel,
  customerTaxConditionLabel,
} from '@erp/shared';
import { usePermissions, useCreateSupplier } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldError } from '@/components/ui/form-section';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { supplierFieldErrors } from '@/components/compras/purchases-errors';

export default function NuevoProveedorPage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const createSupplier = useCreateSupplier();

  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [taxId, setTaxId] = useState('');
  const [taxCondition, setTaxCondition] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ general?: string; taxId?: string }>({});

  if (permissionsLoading) {
    return null;
  }
  if (!can('purchases.suppliers.create')) {
    return <Unauthorized />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      const result = await createSupplier.mutateAsync({
        legalName,
        tradeName: tradeName || undefined,
        documentType: (documentType || undefined) as CustomerDocumentType | undefined,
        taxId: taxId || undefined,
        taxCondition: (taxCondition || undefined) as CustomerTaxCondition | undefined,
        email: email || undefined,
        phone: phone || undefined,
        address: address || undefined,
        city: city || undefined,
        province: province || undefined,
        postalCode: postalCode || undefined,
        notes: notes || undefined,
      });
      router.push(`/compras/proveedores/${result.supplier.id}`);
    } catch (err) {
      setFieldErrors(supplierFieldErrors(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <PageHeader
        title="Nuevo proveedor"
        description="Completá los datos esenciales del proveedor."
        backHref="/compras/proveedores"
        backLabel="Proveedores"
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
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones internas sobre este proveedor…"
          rows={3}
        />
      </div>

      {fieldErrors.general && (
        <p role="alert" className="text-sm text-destructive">
          {fieldErrors.general}
        </p>
      )}

      <div>
        <Button type="submit" disabled={createSupplier.isPending}>
          {createSupplier.isPending ? 'Creando…' : 'Crear proveedor'}
        </Button>
      </div>
    </form>
  );
}
