---
title: ERP — Estado del proyecto y roadmap
aliases:
  - Estado ERP
  - Roadmap ERP
tags:
  - erp
  - roadmap
  - status
  - local-first
  - cloud-ready
last_verified: 2026-09-01
source_of_truth: GitHub main
---

# ERP — Estado del proyecto y roadmap

> [!info] Estado verificado
> Este resumen refleja lo que está **subido a GitHub en `main`** y separa explícitamente lo que está terminado, lo que está en progreso local y lo que todavía no existe. Última base funcional verificada: **Prompt #21 / PR #18 — Suppliers + Purchase Orders + Goods Receipts**.

## Resumen ejecutivo

El ERP ya dejó de ser un prototipo de interfaz: hoy tiene un **núcleo operativo real**, multiempresa, con seguridad, auditoría, inventario por ledger, ventas, Facturación/POS, compras, realtime LAN y cliente de escritorio Electron.

La estrategia de producto sigue siendo:

> **Primero Local, pero Cloud-ready. Nunca Cloud-first si retrasa el producto local; nunca Local-only si obliga a reescribir el core después.**

La prioridad inmediata es cerrar y respaldar correctamente el **Prompt #22 — Cuentas corrientes + Cobros + Pagos**, que comenzó localmente pero todavía no aparece en GitHub. Después de eso, el foco debe volver a la **vendibilidad de la versión local**: instalación estable del servidor, backups/restore y diagnóstico/soporte.

---

# 1. Estado actual en GitHub

## `main`

Última funcionalidad grande mergeada:

- **PR #18 — Suppliers + Purchase Orders + Goods Receipts**
- Merge commit funcional: `2fe2993aedd7c41ecc24cea65fc9252964dca5cc`

La rama `main` contiene por lo tanto todo lo implementado hasta Prompt #21.

## Prompt #22

**Estado:** 🟡 EN PROGRESO LOCAL / NO RESPALDADO EN GITHUB

Objetivo del Prompt #22:

- Cuentas corrientes de clientes
- Cuentas corrientes de proveedores
- Cobros
- Pagos
- Imputaciones parciales/múltiples
- Multi-moneda sin conversión FX
- Integración con SalesDocument / SalesTender / PurchaseReceipt
- Backfill histórico
- Realtime / RBAC / audit

Claude alcanzó el límite de sesión antes de completar el push/PR. A la fecha de esta nota, **no existe todavía una rama remota ni PR de `agent/claude-current-accounts`**.

> [!warning] Riesgo actual
> El trabajo de Prompt #22 puede existir únicamente en la máquina local. Antes de cualquier `checkout`, `reset`, `stash` o limpieza del repo, hay que inspeccionar y respaldar ese working tree.

---

# 2. Qué ya está hecho

## 🟢 Plataforma / arquitectura

- [x] Monorepo npm workspaces
- [x] Backend NestJS + Prisma + PostgreSQL
- [x] Gestión y Facturación como aplicaciones separadas que comparten el mismo core
- [x] POS como modo especializado dentro de Facturación, no como tercera app
- [x] Configuración runtime para host del servidor
- [x] Arquitectura Local-first / Cloud-ready
- [x] RequestContext con tenant / company / branch

## 🟢 Seguridad y administración

- [x] Autenticación
- [x] Sesiones y refresh tokens
- [x] Password reset
- [x] Multiempresa
- [x] Contexto de sucursal
- [x] RBAC granular
- [x] Roles por empresa
- [x] Auditoría / trazabilidad
- [x] Aislamiento estricto entre empresas

## 🟢 Maestros

- [x] Clientes
- [x] Proveedores
- [x] Productos
- [x] Variantes
- [x] Categorías
- [x] Marcas
- [x] Unidades de medida
- [x] Depósitos
- [x] Monedas
- [x] Listas de precios

## 🟢 Inventario

- [x] `StockMovement` como source of truth
- [x] `InventoryBalance` como proyección/cache
- [x] Carga inicial
- [x] Ajustes de stock
- [x] Política de stock negativo
- [x] Movimientos por venta
- [x] Movimientos por recepción de compras
- [x] Reversiones de recepción conservando historia
- [x] Concurrencia probada para evitar inconsistencias

### Parcial

- [~] Stock reservations existen a nivel servicio, pero todavía no son un flujo completo de producto
- [ ] Transferencias entre depósitos/sucursales todavía no forman parte del circuito operativo terminado

## 🟢 Precios

- [x] Listas FIXED y DERIVED
- [x] Historial de precios
- [x] Ajustes masivos
- [x] Resolución centralizada de precios
- [x] Decimal-safe
- [x] Facturación consume el mismo PricingService

## 🟢 Ventas

- [x] `SalesDocument`
- [x] DRAFT → CONFIRMED / CANCELLED
- [x] Confirmación atómica
- [x] Idempotencia
- [x] Price snapshot
- [x] Inventory decrement
- [x] Customer/company isolation
- [x] Gestión → Ventas
- [x] Facturación → Ventas
- [x] POS
- [x] Efectivo / tarjeta / transferencia / otro como snapshot operativo
- [x] Vuelto para efectivo

> `SalesTender` sigue siendo un snapshot operativo de checkout; todavía no es Tesorería ni una cuenta corriente financiera.

## 🟢 Compras — Prompt #21

- [x] Proveedores
- [x] Órdenes de compra
- [x] Recepciones de mercadería
- [x] Recepciones parciales
- [x] Recepción directa sin OC
- [x] PO confirmada no mueve stock
- [x] Recepción confirmada sí mueve stock
- [x] Anulación de recepción mediante movimientos inversos
- [x] Control de sobre-recepción
- [x] Protección de concurrencia multi-PC con PostgreSQL
- [x] ARS / USD como moneda documental
- [x] RBAC
- [x] Audit
- [x] Realtime
- [x] Gestión UI: Proveedores / Órdenes / Recepciones

## 🟢 Experiencia de producto

- [x] Dashboard operativo en Gestión
- [x] Demo seed realista
- [x] Flujo de presentación
- [x] Sistema visual desktop ERP denso / operator-first
- [x] Realtime LAN con Socket.IO
- [x] Invalidaciones TanStack Query
- [x] Reconnect/refetch

## 🟢 Cliente de escritorio

- [x] Electron thin client
- [x] Una única aplicación instalada
- [x] Gestión y Facturación cargadas desde el servidor
- [x] Runtime server URL
- [x] Launcher de configuración
- [x] Diagnóstico de conexión
- [x] Seguridad: sandbox, context isolation, sin Node en workspaces
- [x] Build/packaging Windows probado

## 🟢 Calidad / pruebas

Última referencia grande mergeada (PR #18):

- **243/243** e2e API
- **61/61** unit tests API
- **59/59** tests Facturación
- builds API + Gestión + Facturación correctos
- pruebas específicas de concurrencia para compras

Además existen suites dedicadas para Electron y realtime de las etapas anteriores.

---

# 3. Qué falta para una versión LOCAL vendible

## Prioridad crítica

- [ ] Recuperar/revisar el trabajo local de Prompt #22
- [ ] Commit + push + PR de Prompt #22
- [ ] Review y merge de Prompt #22
- [ ] Instalación reproducible del ERP Server en una PC servidor
- [ ] Ejecutar API + PostgreSQL + Gestión + Facturación como servicios estables
- [ ] Configuración simple de red/LAN
- [ ] Backups automáticos
- [ ] Restore probado
- [ ] Diagnóstico/logs para soporte remoto
- [ ] Procedimiento de actualización/migraciones seguro

## Deseable antes de vender más ampliamente

- [ ] Transferencias de stock
- [ ] Tesorería básica
- [ ] ARCA / facturación fiscal
- [ ] Reportes operativos mínimos

---

# 4. Roadmap actualizado

## FASE 1 — ERP LOCAL OPERATIVO

**Estado: 🟢 MUY AVANZADO**

### Terminado

- [x] Arquitectura
- [x] Auth
- [x] Multiempresa
- [x] Sucursales
- [x] Permisos
- [x] Auditoría
- [x] Clientes
- [x] Productos
- [x] Pricing
- [x] Stock
- [x] Ventas
- [x] Facturación
- [x] POS
- [x] Realtime LAN
- [x] Electron thin client

### Pendiente para cerrar la fase

- [ ] Instalador / runtime del ERP Server
- [ ] Backups + restore
- [ ] Diagnóstico/support tooling
- [ ] Proceso de upgrade/migrations para instalaciones reales

---

## FASE 2 — CIRCUITO COMERCIAL COMPLETO

**Estado: 🟡 EN PROGRESO**

### Terminado

- [x] Proveedores
- [x] Órdenes de compra
- [x] Recepciones
- [x] Recepciones parciales

### En progreso

- [~] Cuentas corrientes clientes — Prompt #22 local
- [~] Cuentas corrientes proveedores — Prompt #22 local
- [~] Cobros — Prompt #22 local
- [~] Pagos — Prompt #22 local

### Pendiente

- [ ] Transferencias de stock
- [ ] Pulido final del circuito comercial

---

## FASE 3 — FINANZAS / TESORERÍA

**Estado: ⚪ NO INICIADA**

- [ ] Caja
- [ ] Cajas por sucursal
- [ ] Apertura/cierre de caja
- [ ] Bancos
- [ ] Mercado Pago
- [ ] Movimientos de tesorería
- [ ] Conciliación
- [ ] Multi-moneda financiera
- [ ] Cheques / valores, si el mercado objetivo lo justifica

La Tesorería debe consumir Cobros/Pagos ya confirmados sin convertir `SalesTender` en el ledger financiero.

---

## FASE 4 — FISCAL / ARCA

**Estado: ⚪ NO INICIADA**

- [ ] Documentos fiscales
- [ ] Factura A/B/C según alcance
- [ ] CAE
- [ ] ARCA
- [ ] IVA
- [ ] Notas de crédito
- [ ] Notas de débito
- [ ] Libros/reportes fiscales necesarios

`SalesDocument` actual es una transacción comercial interna, no una factura fiscal.

---

## FASE 5 — GESTIÓN AVANZADA

**Estado: ⚪ NO INICIADA**

- [ ] Costos
- [ ] Costo promedio / FIFO según decisión futura
- [ ] Rentabilidad
- [ ] Margen por venta/producto/cliente
- [ ] Lotes / partidas
- [ ] Trazabilidad
- [ ] Logística avanzada
- [ ] Reporting gerencial

---

## FASE 6 — EMPRESA MEDIANA / INDUSTRIAL

**Estado: ⚪ NO INICIADA**

- [ ] Contabilidad
- [ ] Plan de cuentas
- [ ] Asientos automáticos
- [ ] Centros de costo
- [ ] Importaciones
- [ ] Producción
- [ ] BOM / fórmulas
- [ ] Órdenes de producción
- [ ] Costeo industrial

---

## FASE 7 — AUTOMATIZACIÓN / ECOSISTEMA

**Estado: ⚪ NO INICIADA**

- [ ] Ingreso automático de documentos con IA/OCR
- [ ] Mercado Libre
- [ ] APIs e integraciones externas
- [ ] Automatizaciones
- [ ] Import/export masivo mejorado

---

## FASE 8 — CLOUD

**Estado: 🟡 ARQUITECTURA PREPARADA / INFRAESTRUCTURA NO IMPLEMENTADA**

El core ya sigue varias reglas Cloud-ready:

- una API como punto de entrada
- separación cliente/servidor
- multiempresa real
- runtime configuration
- sin IP fija en reglas de negocio
- frontend independiente de la ubicación física del servidor
- dominio sin dependencia de Electron
- migraciones reproducibles
- realtime basado en API/DB autoritativos

### Futuro

- [ ] Deploy gestionado
- [ ] HTTPS/domains
- [ ] Provisioning
- [ ] Backups gestionados
- [ ] Observabilidad
- [ ] Operación multi-instancia si hace falta
- [ ] Suscripciones/billing SaaS únicamente cuando exista necesidad comercial

No construir Kubernetes/AWS/autoscaling antes de que un cliente real lo necesite.

---

# 5. Próximas acciones recomendadas

## Ahora mismo

1. **Rescatar Prompt #22 del repo local** sin reset/stash/checkout destructivo.
2. Revisar qué dejó Claude terminado y qué quedó a medias.
3. Crear commits limpios.
4. Push a `agent/claude-current-accounts`.
5. Crear draft PR.
6. Hacer review profunda antes del merge.

## Después del Prompt #22

7. **Server Installer / Runtime Local**.
8. **Backups + Restore + Diagnostics**.
9. Transferencias de stock si son necesarias para el primer cliente.
10. Tesorería.
11. ARCA/fiscal.

Esta secuencia mantiene la estrategia Local-first sin crear deuda que obligue a reescribir el core para Cloud.

---

# 6. Definición actual del producto

> **ERP moderno para PyMEs argentinas, desde un comercio hasta una empresa mediana, con modalidad local primero y preparado para Cloud.**

Dos experiencias de usuario:

```text
Gestión
└── administración / backoffice

Facturación
├── operación de ventas
└── POS
```

Un único core:

```text
Gestión / Facturación / ERP.exe
              ↓
             API
              ↓
        reglas de negocio
              ↓
         PostgreSQL
```

---

# 7. Enlaces útiles del repo

- [Estado de implementación](implementation-status.md)
- [Roadmap histórico](roadmap.md)
- [Arquitectura](architecture.md)
- [Arquitectura Desktop/LAN](desktop-lan-architecture.md)
- [Ventas](sales.md)
- [Facturación](facturacion.md)
- [POS](pos.md)
- [Compras](purchases.md)
- [Inventario](inventory.md)
- [Pricing](pricing.md)
- [Demo](demo-guide.md)

---

# 8. Cómo usar esta nota con Obsidian

Este archivo es Markdown estándar y funciona directamente en Obsidian.

La forma recomendada de compartirlo es mantener **GitHub como source of truth** y abrir el repo (o su carpeta `docs`) como vault de Obsidian, o sincronizarlo mediante el flujo Git que usen ambos colaboradores.

Así:

```text
GitHub repo
   ↓
clone / pull
   ↓
Obsidian vault
   ↓
esta nota + docs del ERP
```

Esto evita tener dos roadmaps que se desactualizan por separado.

> [!note] Regla de mantenimiento
> Cada vez que se mergee un módulo importante, actualizar esta nota junto con `implementation-status.md` y el roadmap correspondiente.
