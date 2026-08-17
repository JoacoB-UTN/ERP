'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  CustomerType,
  CustomerDocumentType,
  CustomerTaxCondition,
  customerTypeLabel,
  customerDocumentTypeLabel,
  customerTaxConditionLabel,
  type CustomerAddressInput,
  type CustomerContactInput,
} from '@erp/shared';
import {
  usePermissions,
  useCreateCustomer,
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
import { AddressCard } from '@/components/clientes/address-card';
import { ContactCard } from '@/components/clientes/contact-card';
import { customerFieldErrors } from '@/components/clientes/form-errors';

function emptyAddress(): CustomerAddressInput {
  return {
    type: 'FISCAL',
    street: '',
    city: '',
    province: '',
    postalCode: '',
    countryCode: 'AR',
    isDefault: false,
  };
}

function emptyContact(): CustomerContactInput {
  return { name: '', isPrimary: false };
}

export default function NuevoClientePage() {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const createCustomer = useCreateCustomer();
  const categoriesQuery = useCustomerCategories();

  const [customerType, setCustomerType] = useState<string>('COMPANY');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [taxId, setTaxId] = useState('');
  const [taxCondition, setTaxCondition] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [mobile, setMobile] = useState('');
  const [website, setWebsite] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());

  const [addresses, setAddresses] = useState<CustomerAddressInput[]>([]);
  const [contacts, setContacts] = useState<CustomerContactInput[]>([]);

  const [fieldErrors, setFieldErrors] = useState<{ general?: string; taxId?: string }>({});

  if (permissionsLoading) {
    return null;
  }
  if (!can('customers.create')) {
    return <Unauthorized />;
  }

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      const result = await createCustomer.mutateAsync({
        customerType: customerType as CustomerType,
        legalName,
        tradeName: tradeName || undefined,
        documentType: (documentType || undefined) as CustomerDocumentType | undefined,
        taxId: taxId || undefined,
        taxCondition: (taxCondition || undefined) as CustomerTaxCondition | undefined,
        email: email || undefined,
        phone: phone || undefined,
        mobile: mobile || undefined,
        website: website || undefined,
        creditLimit: creditLimit || null,
        discountPercentage: discountPercentage || null,
        notes: notes || undefined,
        addresses,
        contacts,
        categoryIds: [...selectedCategoryIds],
      });
      router.push(`/clientes/${result.customer.id}`);
    } catch (err) {
      setFieldErrors(customerFieldErrors(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <PageHeader
        title="Nuevo cliente"
        description="Completá los datos esenciales; domicilios, contactos y condiciones pueden ampliarse después."
        backHref="/clientes"
        backLabel="Clientes"
      />

      <FormSection title="Datos principales" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customerType">Tipo de cliente</Label>
            <Select id="customerType" value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
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
            <Input
              id="legalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              required
              autoFocus
            />
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

      <FormSection title="Domicilios" description="Fiscal, entrega, depósito…">
        <div className="flex flex-col gap-3">
          {addresses.map((address, index) => (
            <AddressCard
              key={index}
              value={address}
              onChange={(next) => setAddresses((prev) => prev.map((a, i) => (i === index ? next : a)))}
              onRemove={() => setAddresses((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setAddresses((prev) => [...prev, emptyAddress()])}
          >
            <Plus className="size-4" />
            Agregar domicilio
          </Button>
        </div>
      </FormSection>

      <FormSection title="Contactos" description="Personas de contacto en la empresa del cliente">
        <div className="flex flex-col gap-3">
          {contacts.map((contact, index) => (
            <ContactCard
              key={index}
              value={contact}
              onChange={(next) => setContacts((prev) => prev.map((c, i) => (i === index ? next : c)))}
              onRemove={() => setContacts((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setContacts((prev) => [...prev, emptyContact()])}
          >
            <Plus className="size-4" />
            Agregar contacto
          </Button>
        </div>
      </FormSection>

      <FormSection title="Información comercial" description="Límite de crédito, descuento y categorías">
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
        {(categoriesQuery.data?.categories.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Categorías</Label>
            <div className="flex flex-wrap gap-3">
              {categoriesQuery.data?.categories.map((category) => (
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
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones internas sobre este cliente…"
          rows={3}
        />
      </FormSection>

      {fieldErrors.general && (
        <p role="alert" className="text-sm text-destructive">
          {fieldErrors.general}
        </p>
      )}

      <div>
        <Button type="submit" disabled={createCustomer.isPending}>
          {createCustomer.isPending ? 'Creando…' : 'Crear cliente'}
        </Button>
      </div>
    </form>
  );
}
