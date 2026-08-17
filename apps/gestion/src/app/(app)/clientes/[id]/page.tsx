'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Trash2, Plus } from 'lucide-react';
import {
  customerTypeLabel,
  customerDocumentTypeLabel,
  customerTaxConditionLabel,
  customerAddressTypeLabel,
  formatDecimalDisplay,
  type CustomerDetail,
  type CustomerAddressDto,
  type CustomerContactDto,
  type CustomerAddressInput,
  type CustomerContactInput,
} from '@erp/shared';
import {
  usePermissions,
  useCustomer,
  useCustomerHistory,
  useDeactivateCustomer,
  useReactivateCustomer,
  useAddCustomerAddress,
  useUpdateCustomerAddress,
  useRemoveCustomerAddress,
  useAddCustomerContact,
  useUpdateCustomerContact,
  useRemoveCustomerContact,
} from '@/lib/auth-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Unauthorized } from '@/components/layout/unauthorized';
import { AddressCard } from '@/components/clientes/address-card';
import { ContactCard } from '@/components/clientes/contact-card';
import { CustomerHistoryItem } from '@/components/clientes/customer-history-item';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

type TabKey = 'datos' | 'domicilios' | 'contactos' | 'historial';

export default function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const customerQuery = useCustomer(id ?? null);

  if (permissionsLoading || customerQuery.isLoading) {
    return null;
  }
  if (!can('customers.read') || !customerQuery.data) {
    return <Unauthorized />;
  }

  return (
    <ClienteDetailView
      customer={customerQuery.data.customer}
      canUpdate={can('customers.update')}
      canDeactivate={can('customers.deactivate')}
    />
  );
}

function ClienteDetailView({
  customer,
  canUpdate,
  canDeactivate,
}: {
  customer: CustomerDetail;
  canUpdate: boolean;
  canDeactivate: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('datos');
  const deactivate = useDeactivateCustomer();
  const reactivate = useReactivateCustomer();

  async function handleToggleStatus() {
    if (customer.status === 'ACTIVE') {
      if (!window.confirm(`¿Desactivar el cliente "${customer.displayName}"?`)) return;
      await deactivate.mutateAsync(customer.id);
    } else {
      await reactivate.mutateAsync(customer.id);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'datos', label: 'Datos' },
    { key: 'domicilios', label: `Domicilios (${customer.addresses.length})` },
    { key: 'contactos', label: `Contactos (${customer.contacts.length})` },
    { key: 'historial', label: 'Historial' },
  ];

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{customer.displayName}<StatusBadge status={customer.status}>{customer.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</StatusBadge></span>}
        description={<>
            {customer.code}
            {customer.tradeName && ` · ${customer.legalName}`}
            {customer.taxIdFormatted && ` · CUIT ${customer.taxIdFormatted}`}
          </>}
        backHref="/clientes"
        backLabel="Clientes"
        actions={<>
          {canUpdate && (
            <Link href={`/clientes/${customer.id}/editar`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil className="size-4" />
              Editar
            </Link>
          )}
          {canDeactivate && (
            <Button
              type="button"
              variant={customer.status === 'ACTIVE' ? 'destructive' : 'outline'}
              onClick={handleToggleStatus}
              disabled={deactivate.isPending || reactivate.isPending}
            >
              {customer.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
            </Button>
          )}
        </>}
      />

      <div role="tablist" aria-label="Secciones del cliente" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'datos' && <DatosTab customer={customer} />}
      {tab === 'domicilios' && <DomiciliosTab customer={customer} canUpdate={canUpdate} />}
      {tab === 'contactos' && <ContactosTab customer={customer} canUpdate={canUpdate} />}
      {tab === 'historial' && <HistorialTab customerId={customer.id} />}
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? '—'}</dd>
    </div>
  );
}

function DatosTab({ customer }: { customer: CustomerDetail }) {
  return (
    <dl className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
      <SummaryField label="Tipo de cliente" value={customerTypeLabel(customer.customerType)} />
      <SummaryField label="Razón social / Nombre" value={customer.legalName} />
      <SummaryField label="Nombre comercial" value={customer.tradeName} />
      <SummaryField
        label="Documento"
        value={customer.documentType ? customerDocumentTypeLabel(customer.documentType) : null}
      />
      <SummaryField label="CUIT / Documento" value={customer.taxIdFormatted} />
      <SummaryField
        label="Condición frente al IVA"
        value={customer.taxCondition ? customerTaxConditionLabel(customer.taxCondition) : null}
      />
      <SummaryField label="Email" value={customer.email} />
      <SummaryField label="Teléfono" value={customer.phone} />
      <SummaryField label="Celular" value={customer.mobile} />
      <SummaryField label="Sitio web" value={customer.website} />
      <SummaryField
        label="Límite de crédito"
        value={customer.creditLimit ? `$${formatDecimalDisplay(customer.creditLimit)}` : null}
      />
      <SummaryField
        label="Descuento predeterminado"
        value={customer.discountPercentage ? `${formatDecimalDisplay(customer.discountPercentage)}%` : null}
      />
      {customer.categories.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Categorías</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {customer.categories.map((c) => (
              <span key={c.id} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {c.name}
              </span>
            ))}
          </dd>
        </div>
      )}
      {customer.notes && (
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Notas</dt>
          <dd className="text-sm whitespace-pre-wrap">{customer.notes}</dd>
        </div>
      )}
    </dl>
  );
}

function emptyAddressDraft(): CustomerAddressInput {
  return { type: 'FISCAL', street: '', city: '', province: '', postalCode: '', countryCode: 'AR', isDefault: false };
}

function DomiciliosTab({ customer, canUpdate }: { customer: CustomerDetail; canUpdate: boolean }) {
  const addAddress = useAddCustomerAddress();
  const updateAddress = useUpdateCustomerAddress();
  const removeAddress = useRemoveCustomerAddress();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<CustomerAddressInput | null>(null);

  function startNew() {
    setEditingId('new');
    setDraft(emptyAddressDraft());
  }
  function startEdit(address: CustomerAddressDto) {
    setEditingId(address.id);
    setDraft({
      type: address.type,
      label: address.label ?? undefined,
      street: address.street,
      number: address.number ?? undefined,
      floor: address.floor ?? undefined,
      unit: address.unit ?? undefined,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      additionalInfo: address.additionalInfo ?? undefined,
      isDefault: address.isDefault,
    });
  }
  function cancel() {
    setEditingId(null);
    setDraft(null);
  }
  async function save() {
    if (!draft) return;
    if (editingId === 'new') {
      await addAddress.mutateAsync({ customerId: customer.id, input: draft });
    } else if (editingId) {
      await updateAddress.mutateAsync({ customerId: customer.id, addressId: editingId, input: draft });
    }
    cancel();
  }
  async function remove(addressId: string) {
    if (!window.confirm('¿Eliminar este domicilio?')) return;
    await removeAddress.mutateAsync({ customerId: customer.id, addressId });
  }

  return (
    <div className="flex flex-col gap-3">
      {customer.addresses.map((address) =>
        editingId === address.id && draft ? (
          <div key={address.id} className="flex flex-col gap-2">
            <AddressCard value={draft} onChange={setDraft} onRemove={cancel} />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={updateAddress.isPending}>
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div key={address.id} className="flex items-start justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">
                {customerAddressTypeLabel(address.type)}
                {address.isDefault && <span className="ml-1.5 text-xs text-muted-foreground">(predeterminado)</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {address.street} {address.number}, {address.city}, {address.province} ({address.postalCode})
              </p>
            </div>
            {canUpdate && (
              <div className="flex gap-1">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(address)}>
                  <Pencil className="size-4" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => remove(address.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
        ),
      )}
      {editingId === 'new' && draft && (
        <div className="flex flex-col gap-2">
          <AddressCard value={draft} onChange={setDraft} onRemove={cancel} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={addAddress.isPending}>
              Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {customer.addresses.length === 0 && editingId !== 'new' && (
        <p className="text-sm text-muted-foreground">Sin domicilios registrados.</p>
      )}
      {canUpdate && editingId !== 'new' && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={startNew}>
          <Plus className="size-4" />
          Agregar domicilio
        </Button>
      )}
    </div>
  );
}

function emptyContactDraft(): CustomerContactInput {
  return { name: '', isPrimary: false };
}

function ContactosTab({ customer, canUpdate }: { customer: CustomerDetail; canUpdate: boolean }) {
  const addContact = useAddCustomerContact();
  const updateContact = useUpdateCustomerContact();
  const removeContact = useRemoveCustomerContact();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<CustomerContactInput | null>(null);

  function startNew() {
    setEditingId('new');
    setDraft(emptyContactDraft());
  }
  function startEdit(contact: CustomerContactDto) {
    setEditingId(contact.id);
    setDraft({
      name: contact.name,
      role: contact.role ?? undefined,
      email: contact.email ?? undefined,
      phone: contact.phone ?? undefined,
      mobile: contact.mobile ?? undefined,
      notes: contact.notes ?? undefined,
      isPrimary: contact.isPrimary,
    });
  }
  function cancel() {
    setEditingId(null);
    setDraft(null);
  }
  async function save() {
    if (!draft) return;
    if (editingId === 'new') {
      await addContact.mutateAsync({ customerId: customer.id, input: draft });
    } else if (editingId) {
      await updateContact.mutateAsync({ customerId: customer.id, contactId: editingId, input: draft });
    }
    cancel();
  }
  async function remove(contactId: string) {
    if (!window.confirm('¿Eliminar este contacto?')) return;
    await removeContact.mutateAsync({ customerId: customer.id, contactId });
  }

  return (
    <div className="flex flex-col gap-3">
      {customer.contacts.map((contact) =>
        editingId === contact.id && draft ? (
          <div key={contact.id} className="flex flex-col gap-2">
            <ContactCard value={draft} onChange={setDraft} onRemove={cancel} />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={updateContact.isPending}>
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div key={contact.id} className="flex items-start justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">
                {contact.name}
                {contact.isPrimary && <span className="ml-1.5 text-xs text-muted-foreground">(principal)</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {[contact.role, contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            {canUpdate && (
              <div className="flex gap-1">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => startEdit(contact)}>
                  <Pencil className="size-4" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => remove(contact.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
        ),
      )}
      {editingId === 'new' && draft && (
        <div className="flex flex-col gap-2">
          <ContactCard value={draft} onChange={setDraft} onRemove={cancel} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={addContact.isPending}>
              Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {customer.contacts.length === 0 && editingId !== 'new' && (
        <p className="text-sm text-muted-foreground">Sin contactos registrados.</p>
      )}
      {canUpdate && editingId !== 'new' && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={startNew}>
          <Plus className="size-4" />
          Agregar contacto
        </Button>
      )}
    </div>
  );
}

function HistorialTab({ customerId }: { customerId: string }) {
  const historyQuery = useCustomerHistory(customerId);
  const items = historyQuery.data?.items ?? [];

  if (historyQuery.isLoading) {
    return null;
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay eventos registrados para este cliente.</p>;
  }
  return (
    <div className="rounded-xl border border-border px-4">
      {items.map((item) => (
        <CustomerHistoryItem key={item.id} item={item} />
      ))}
    </div>
  );
}
