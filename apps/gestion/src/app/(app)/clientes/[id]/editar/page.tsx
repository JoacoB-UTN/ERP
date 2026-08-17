'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  CustomerType,
  CustomerDocumentType,
  CustomerTaxCondition,
  customerTypeLabel,
  customerDocumentTypeLabel,
  customerTaxConditionLabel,
  type CustomerDetail,
  type CustomerCategoryDto,
} from '@erp/shared';
import {
  usePermissions,
  useCustomer,
  useUpdateCustomer,
  useCustomerCategories,
} from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { Unauthorized } from '@/components/layout/unauthorized';
import { FormSection, FieldError } from '@/components/clientes/customer-form-sections';
import { customerFieldErrors } from '@/components/clientes/form-errors';

export default function EditarClientePage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const customerQuery = useCustomer(id ?? null);
  const categoriesQuery = useCustomerCategories();

  if (permissionsLoading || customerQuery.isLoading || categoriesQuery.isLoading) {
    return null;
  }
  if (!can('customers.update') || !customerQuery.data) {
    return <Unauthorized />;
  }

  return (
    <EditarClienteForm
      key={customerQuery.data.customer.id}
      customer={customerQuery.data.customer}
      categories={categoriesQuery.data?.categories ?? []}
    />
  );
}

function EditarClienteForm({
  customer,
  categories,
}: {
  customer: CustomerDetail;
  categories: CustomerCategoryDto[];
}) {
  const router = useRouter();
  const updateCustomer = useUpdateCustomer();

  const [customerType, setCustomerType] = useState(customer.customerType);
  const [legalName, setLegalName] = useState(customer.legalName);
  const [tradeName, setTradeName] = useState(customer.tradeName ?? '');
  const [documentType, setDocumentType] = useState(customer.documentType ?? '');
  const [taxId, setTaxId] = useState(customer.taxId ?? '');
  const [taxCondition, setTaxCondition] = useState(customer.taxCondition ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [mobile, setMobile] = useState(customer.mobile ?? '');
  const [website, setWebsite] = useState(customer.website ?? '');
  const [creditLimit, setCreditLimit] = useState(customer.creditLimit ?? '');
  const [discountPercentage, setDiscountPercentage] = useState(customer.discountPercentage ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    new Set(customer.categories.map((c) => c.id)),
  );

  const [fieldErrors, setFieldErrors] = useState<{ general?: string; taxId?: string }>({});

  function toggleCategory(catId: string) {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      await updateCustomer.mutateAsync({
        id: customer.id,
        input: {
          customerType,
          legalName,
          tradeName: tradeName || null,
          documentType: (documentType || null) as CustomerDocumentType | null,
          taxId: taxId || null,
          taxCondition: (taxCondition || null) as CustomerTaxCondition | null,
          email: email || null,
          phone: phone || null,
          mobile: mobile || null,
          website: website || null,
          creditLimit: creditLimit || null,
          discountPercentage: discountPercentage || null,
          notes: notes || null,
          categoryIds: [...selectedCategoryIds],
        },
      });
      router.push(`/clientes/${customer.id}`);
    } catch (err) {
      setFieldErrors(customerFieldErrors(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <PageHeader
        title="Editar cliente"
        description={`${customer.code} · ${customer.displayName}`}
        backHref={`/clientes/${customer.id}`}
        backLabel="Volver al cliente"
      />

      <FormSection title="Datos principales" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customerType">Tipo de cliente</Label>
            <Select
              id="customerType"
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value as CustomerType)}
            >
              {Object.values(CustomerType).map((value) => (
                <option key={value} value={value}>
                  {customerTypeLabel(value)}
                </option>
              ))}
            </Select>
          </div>
          <div />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="legalName">Razón social / Nombre</Label>
            <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mobile">Celular</Label>
            <Input id="mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="website">Sitio web</Label>
            <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
      </FormSection>

      <FormSection title="Información comercial" description="Límite de crédito, descuento y categorías" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="creditLimit">Límite de crédito</Label>
            <Input
              id="creditLimit"
              type="number"
              inputMode="decimal"
              min="0"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="discountPercentage">Descuento predeterminado (%)</Label>
            <Input
              id="discountPercentage"
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              value={discountPercentage}
              onChange={(e) => setDiscountPercentage(e.target.value)}
            />
          </div>
        </div>
        {categories.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Categorías</Label>
            <div className="flex flex-wrap gap-3">
              {categories.map((category) => (
                <label key={category.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedCategoryIds.has(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </FormSection>

      <FormSection title="Notas">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </FormSection>

      {fieldErrors.general && (
        <p role="alert" className="text-sm text-destructive">
          {fieldErrors.general}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={updateCustomer.isPending}>
          {updateCustomer.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/clientes/${customer.id}`)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
