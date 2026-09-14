# Task 016 — Transferencias de stock entre depósitos

Status: IN PROGRESS
Depends on: 008 (Inventory)
Agent: Claude
Base branch: main
Branch: feature/stock-transfers
PR:

## Objective

Mover stock entre dos depósitos de la misma empresa como **un solo
documento**, en lugar de un ajuste de salida en uno y otro ajuste de
entrada, sin relación entre sí, en el otro.

El documento tiene número propio por empresa, un estado
(borrador/confirmada/anulada) y deja en el ledger el par de movimientos
`TRANSFER_OUT`/`TRANSFER_IN` que hoy están reservados en el enum
`MovementType` pero que nada produce.

Antes de hacer cambios:

- Leer AGENTS.md.
- Leer [docs/inventory.md](../../docs/inventory.md) y
  [docs/implementation-status.md](../../docs/implementation-status.md).
- Inspeccionar la implementación actual de `StockAdjustment` — es el
  patrón a seguir, y el estado del repositorio manda por sobre este
  archivo.

## Acceptance criteria

**Modelo de datos**

- `StockTransfer`, `StockTransferLine` y `StockTransferSequence`, con el
  enum `StockTransferStatus` (DRAFT/CONFIRMED/CANCELLED).
- Numeración por empresa (`TR-000001`) con el mismo patrón de upsert
  atómico que `StockAdjustmentSequence`, nunca `MAX(number)+1`.
- Las cantidades de línea son **estrictamente positivas**: el encabezado
  ya dice hacia dónde va el stock.
- La migración es puramente aditiva y segura para una base con datos:
  sin DROP, sin ALTER destructivo, sin borrar filas.

**Comportamiento**

- Un borrador se puede editar y no mueve stock.
- Confirmar escribe, en **una sola transacción**, dos movimientos por
  línea: `TRANSFER_OUT` en origen y `TRANSFER_IN` en destino, ambos con
  `referenceType: 'StockTransfer'`.
- El OUT se escribe primero, de modo que un origen sin stock suficiente
  aborte la transacción entera antes de acreditar el destino.
- Una transferencia confirmada es inmutable: no se edita ni se borra.
- Anular una confirmada agrega un **par compensatorio** (los mismos
  depósitos, invertidos). Nunca modifica ni borra movimientos previos.
- Anular un borrador no toca el ledger.
- Confirmar dos veces es imposible, no simplemente improbable: un UPDATE
  condicional sobre `status = 'DRAFT'` abre la transacción.
- Origen y destino deben ser distintos.
- Aislamiento estricto por `companyId`; un depósito de otra empresa
  responde *no encontrado*, nunca *no es tuyo*.
- Auditoría dentro de la misma transacción; realtime solamente después
  del commit.

**Permisos**

- `inventory.transfers.read/create/confirm/cancel`, agregados al
  catálogo y a los roles de sistema que correspondan.
- `cancel` tiene código propio, a diferencia de ajustes: anular una
  confirmada escribe movimientos, no es una edición de borrador.

**UI (Gestión)**

- Listado con filtros por depósito (cualquiera de los dos extremos) y
  por estado, alta, edición de borrador, detalle con confirmar y anular.
- Estados de carga, vacío y error. Acciones gateadas por permiso.
- Entrada en el menú lateral.

**Tests**

- e2e de backend: creación y edición, confirmación y movimientos en
  ambos depósitos, stock insuficiente con rollback completo, anulación
  con movimientos compensatorios, confirmación y anulación duplicadas,
  aislamiento entre empresas, permisos, y dos operaciones concurrentes
  compitiendo por el mismo stock.
- Test de UI del flujo principal.

**Documentación**

- `docs/inventory.md` y `docs/implementation-status.md` actualizados en
  el mismo cambio, incluida la eliminación de las afirmaciones que hoy
  dicen que las transferencias no existen.

## Out of scope

- Transferencias en dos pasos (despacho/recepción) y cualquier estado
  "en tránsito". Una transferencia confirmada mueve el stock al instante.
- Por lo mismo, `INCOMING` sigue exponiéndose como `0`.
- Transferencias entre empresas o entre tenants.
- Costeo, valorización o cualquier efecto contable del movimiento.
- Transferencias desde Facturación o POS: es una operación de Gestión.
- Refactors generales del módulo de inventario.
