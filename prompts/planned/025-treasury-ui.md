# 025 — UI de Tesorería en Gestión

Estado: IMPLEMENTADO; revisión humana, recorrido visual y merge pendientes.
Fecha: 2026-10-03.
Owner: Codex UI; integración y revisión por coordinador independiente.
Rama de entrega: `agent/codex-treasury-delivery`.
Base verificada: `main` / `6dac59ffc89174f4ce6a9af5df08577e682e2da2` (PR #60).

Sync central queda pospuesto. El plan 024 se conserva fuera de esta entrega. PR #17 permanece abierto y sin mergear. Ningún agente debe mergear esta implementación.

## Ownership y dependencias

Allowlist implementada:

- Nuevas rutas/componentes/tests bajo `apps/gestion/src/app/(app)/tesoreria/`.
- Navegación mínima en `apps/gestion/src/components/layout/sidebar.tsx` y export de hooks en `apps/gestion/src/lib/auth-client.ts`.
- Nuevo `packages/auth-client/src/treasury-hooks.ts` y registro en `packages/auth-client/src/hooks.ts`. Ampliación coordinada de revisión: `packages/auth-client/src/api-client.ts` para opción opt-in `expectedCompanyId`, sin modificar comportamiento de otros consumidores. `useTreasuryAccountOptions` y su implementación siguen compatibles, sin cambios.
- Ampliación explícita del coordinador: `apps/api/src/treasury/treasury-accounts.controller.ts`, `treasury-accounts.service.ts` y nuevo `apps/api/test/treasury-currencies.e2e-spec.ts`, únicamente catálogo de monedas.
- Este documento.

El worker de UI mantuvo ownership exclusivo de `packages/auth-client`. El coordinador integró después la corrección de recuperación de saldo negativo en `treasury.service.ts`, sus regresiones y la documentación del módulo/estado/roadmap. No se modificaron contratos shared, Prisma/migrations/seed, backend auth/company-context/authorization/audit, UI compartida, lockfile/configuración raíz/CI ni Cobros/Pagos. Demo se entrega en un PR independiente. No hay dependencia de ramas sin mergear.

## Resultado funcional y criterios de aceptación

| Ruta / superficie | Resultado |
| --- | --- |
| `/tesoreria` | Cajas/bancos, filtro por tipo, incluir inactivas, saldo de cada cuenta con su moneda; sin total mixto. Mensaje visible de exclusión POS y documentos históricos sin cuenta. |
| `/tesoreria/nueva` | Crear cuenta: código/nombre, tipo/moneda, sucursal opcional, notas, datos bancarios y descubierto solo en banco. |
| `/tesoreria/[id]` | Detalle, edición de metadatos, activar/desactivar vía PATCH, apertura mediante movimiento con permiso propio. Código/tipo/moneda inmutables en edición; campos clearable envían null. |
| Extracto dentro del detalle | Desde/hasta inclusivo al final del día local, tipo de movimiento, paginación de 25, importes y saldo acumulado recibidos del backend. Origen con etiquetas españolas, referencia y compensación; no se recalculan saldos. |
| `/tesoreria/transferencias` | Lista paginada y filtro de estado. |
| `/tesoreria/transferencias/nueva` | Borrador con cuentas activas de igual moneda; destino se limpia al cambiar origen. Importe conserva string decimal. |
| `/tesoreria/transferencias/[id]` | Editar borrador, revisar/confirmar, revisar/anular únicamente transferencias CONFIRMED (no DRAFT ni CANCELLED); estados y acciones según permisos y estado devuelto por API. Anulación confirmada explica compensaciones; no edición de historia. Fecha original conserva segundos/milisegundos al editar otro campo. |

Permisos: lectura de cuentas y movimientos separados; extracto requiere ambos. Apertura exige `treasury.movements.create`. Crear/editar cuentas y crear/editar/confirmar/anular transferencias usan sus permisos específicos. Selección de cuentas para transferir requiere además lectura de cuentas. Se evita consulta de endpoints protegidos cuando falta su permiso; el backend conserva toda autorización efectiva y reglas financieras.

Aislamiento: layout remonta todo el árbol por empresa, limpiando formularios, selecciones, diálogos y callbacks anteriores. Queries `['company', companyId, 'treasury', ...]`; placeholder solo reutiliza datos de la misma empresa. Mutaciones rechazan una closure de empresa vieja antes de enviar. Respuestas tardías de formularios desmontados no navegan en la nueva empresa. Invalidación de cuenta/saldo/extracto/transferencia y caché legacy `treasury-accounts` por empresa de origen.

Estados de carga/error/vacío y reintento presentes. No se muestran tablas con datos de error/refetch fallido. No se implementa movimiento manual genérico, arqueo, conciliación, cheques, FX o POS; no hay API autorizada para esos nuevos flujos. Las reglas de signo, vigencia de apertura, cuenta activa, moneda y compensación siguen siendo responsabilidad del API; la UI informa sus rechazos.

## Endpoint mínimo agregado por coordinación

`GET /api/v1/treasury/accounts/currencies`, declarado antes de `:id`, con `treasury.accounts.create`.

Devuelve `CurrenciesResponse` / `CurrencyDto` existentes: monedas activas ordenadas por código, únicamente `id/code/name/symbol/decimalPlaces/active`. Currency es catálogo global; se mantienen autenticación y validación de empresa de la infraestructura vigente. Controller delega servicio; no cambia permisos catálogo ni schemas.

Motivo: el endpoint existente `/pricing/currencies` exige `pricing.lists.read`. Crear una cuenta con permiso propio de Tesorería no debe depender de acceso a Precios. `useTreasuryCurrencies` consume el nuevo endpoint solo en creación; editar una cuenta usa su moneda inmutable y no pide create.

## Correcciones de revisión

P1 resuelto: cada query/mutación Treasury pasa `expectedCompanyId` al cliente API real. Se comprueba la selección antes de cada intento, después de recibir respuesta, después de refresh, después de parsear error y después de parsear JSON/blob. Si A cambió a B se aborta con `COMPANY_CONTEXT_CHANGED`, no se reenvía la operación con headers de B, no se cachea B bajo A ni se limpia B por un error tardío de A. El header de empresa usa el contexto esperado; empresa y sucursal se leen/validan sin awaits intermedios antes de enviar, impidiendo companyA/branchB tras un cambio de empresa. Sin opt-in el comportamiento previo queda intacto; no cambia store, sesiones ni backend auth.

P2 resuelto: el backend solo permite anular CONFIRMED. El botón, revisión y ejecución local exigen ese estado; se eliminó la promesa de anular borradores. DRAFT conserva edición/confirmación; CANCELLED no ofrece anulación.

## Verificación de la entrega integrada

- `npm run typecheck`: PASS en todos los workspaces.
- `npm run test:gestion`: PASS 116/116; incluye 30 regresiones de Tesorería (16 UI + 14 hooks).
- `npm run test:facturacion`: PASS 71/71.
- `npm test`: PASS 114/114 unitarias API.
- `npm run lint`: PASS, sin errores; conserva warnings preexistentes de navegación en los clientes auth de Gestión y Facturación.
- `npm run build`: PASS, producción API/Gestión/Facturación. El primer intento se interrumpió por espacio insuficiente; se eliminaron únicamente dependencias/builds temporales propios y el segundo pase completo terminó correctamente.
- `git diff --check`: PASS.
- Integración real: 87/87 casos de Treasury/transferencias/current-accounts para recuperación de saldo, más 3/3 del catálogo de monedas, con PostgreSQL 16 y Redis descartables. Se aplicaron migraciones existentes, sin seed; servicios detenidos al finalizar. No se modificó la base del usuario.

Las regresiones del cliente usan `createApiClient` real con fetch simulado: renovación 401 normal, cambio A→B durante refresh para consultas y creación de cuentas, respuestas/errores tardíos y revalidación después de parseo asíncrono. Comprueban que no haya retry a B ni datos de B cacheados bajo A. Se conserva compatibilidad sin opt-in. La UI prueba permisos, Decimal strings, extractos, estado de transferencias y revisión de confirmación/anulación.

No se realizó recorrido visual en navegador ni ensayo manual de servidor local. Sigue pendiente esa aceptación y la revisión humana antes del merge. Auditar el cambio de empresa durante requests de consumidores legacy sin `expectedCompanyId` es un seguimiento separado; esta entrega aplica el refuerzo a Tesorería.
