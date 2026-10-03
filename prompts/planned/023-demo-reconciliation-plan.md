# 023 — Conciliación de demo (orden D)

Fecha: 2026-10-03. Estado: RESIDUAL DOCUMENTAL CORREGIDO; verificación runtime pendiente.

## Segunda etapa: conciliación documental sobre main actualizado

El coordinador autorizó editar únicamente `docs/demo-guide.md`,
`prompts/planned/015-demo-data-presentation-flow.md` y este plan. Esta orden
reemplaza el límite de solo planificación de la primera etapa registrada
más abajo. No habilita cambios de código, seed, migraciones, contratos,
infraestructura compartida, roadmap ni implementation-status.

La rama `agent/codex-demo-reconciliation-plan` se actualizó por fast-forward
a la referencia local `origin/main`, SHA
`6dac59ffc89174f4ce6a9af5df08577e682e2da2`. No hubo fetch ni merge commit.
El documento 023 untracked se conservó en memoria antes de avanzar y su
SHA-256 antes/después fue idéntico:
`1de5e63ff3d302f9adeef2e9df861744646c73189a42bd88e289d071dfb4e6c0`.
La ruta de worktree y el ID de tarea indicados abajo se mantienen.

Se revisó el delta de base: seed, rutas del recorrido, servicio de Dashboard,
Sales y scripts citados no cambiaron. Se volvieron a contrastar nombres,
conteos, precios, movimientos, fechas, selección POS y comandos. La guía
corrige esos datos, propone un recorrido de 13–15 minutos y sustituye el
reset rutinario por preparación futura en base descartable. 015 pasa de
PLANNED a **PARTIAL**, sin declararlo DONE ni moverlo.

La guía vigente es `docs/demo-guide.md`; la tabla inferior conserva las
**afirmaciones de la guía anterior** como evidencia del diagnóstico, no como
instrucciones vigentes. El historial de precios se limita a entradas INITIAL;
no se agregó dataset. El guion no entra en Accounts/Treasury/Cobros/Pagos.

Validación de esta segunda etapa: referencias locales y páginas existentes,
scripts npm citados, conteos/offsets del seed y aritmética exacta de precios,
stock y totales; revisión del diff, whitespace y allowlist. No se ejecutaron
comandos de aplicación, tests/build, migraciones, seed, servidores ni
conexiones a bases. La CI de PR #60 comunicada por el coordinador no se
presenta como ejecución propia ni como ensayo de la demo.

Pendientes: habilitar el entorno descartable, comparar doble seed, ensayar
el flujo real y registrar resultados con fecha/zona/SHA antes del cierre.
No hay commit, push, PR, merge publicado ni comentarios externos de este
residual. Roadmap e implementation-status permanecen bajo el coordinador.

## Registro de la primera etapa: plan y evidencia estática

Lo que sigue registra el alcance autorizado inicialmente, antes del
fast-forward y de las correcciones documentales de la segunda etapa.

- Task / owner: Worker D, Codex.
- Base: `main` @ `1fadbd83f8111d788f076a72585c3198a75a016c`; HEAD coincidía en la primera etapa. No se consultó el remoto.
- Rama creada desde detached HEAD: `agent/codex-demo-reconciliation-plan`.
- Allowlist de la primera etapa: únicamente este archivo nuevo, `prompts/planned/023-demo-reconciliation-plan.md`.
- Dependencias: ninguna de Worker S ni de ramas sin integrar. El commit `e48fd0e` (demo, PR #11) es ancestro de HEAD; se verificó con Git.
- Límites: todos los archivos existentes quedan sin cambios. Prisma/migrations/seed, contratos/clientes/UI compartidos, auth/contexto/RBAC/audit y configuración/lockfile/CI están reservados. Accounts/Treasury/Cobros/Pagos quedan fuera de auditoría y del alcance futuro. `docs/implementation-status.md` pertenece al coordinador. PR #17 intacto.

## Diagnóstico de 015

**Diagnóstico inicial: implementación sustancial existente; cierre documental/verificación parcial.** `015-demo-data-presentation-flow.md` conservaba `PLANNED`, aunque `e48fd0e` incorporó seed enriquecido y guía. No volver a construir el dataset. El residual mínimo es conciliar nombres, rutas, conteos, condiciones temporales y evidencias, y ensayar el flujo actual. El objetivo menciona más historial de precios, pero `ensureInitialPrice` solo crea una entrada `INITIAL` por variante/lista: no prometer múltiples cambios históricos. Proponer al coordinador cerrar 015 después del ensayo y dejar explícito ese alcance, sin ampliar seed en esta tanda.

Referencias de la tabla: `seed` significa `apps/api/prisma/seed.ts`, con líneas de esta base. Son hechos del código o resultados calculados, **no resultados obtenidos de una base ni del navegador**.

## Guía frente a evidencia

| Afirmación de `docs/demo-guide.md` | Evidencia estática | Corrección / verificación pendiente |
| --- | --- | --- |
| Dos empresas; ANRAS, «Second Demo Company» y «Distribuidora Horizonte» en distintas secciones | seed:2810–2907 declara ANRAS, CABACO y BLANCO BAHIA en el mismo tenant; ANRAS recibe los datos ilustrativos. Desde 2909 hay además un fixture de otro tenant sin acceso para el administrador. | Usar ANRAS en ambas apps; hablar de tres empresas accesibles, no de tres empresas totales en la base. Comprobar selector en navegador. |
| Casa Central y Sucursal Norte | seed:2829–2854; depósitos en `seedWarehousesAndStock` desde 905 | Se mantienen. Elegir ANRAS → Casa Central → Depósito Central → Minorista explícitamente. |
| 16 clientes «más» Consumidor Final; Ferretería El Puente | seed:79–477: códigos 000001–000016, Consumidor Final incluido, uno inactivo; Ferretería tiene razón social «Ferretería El Puente S.R.L.», nombre comercial «Ferretería El Puente», CUIT 30712345671 (204–207). | 16 en total, 15 activos. No confundir el contador de activos con todo el catálogo. Comprobar búsqueda/nombre presentado. |
| 17 productos / 21 variantes; Café, Buzo, Gaseosa, Flete | seed:630–821: Café SKU CAFE-1KG, Buzo 4 variantes, Gaseosa código de barras 7790001000019, 3 servicios, Cinta inactiva | Conteos del catálogo coherentes; 16 productos activos. No llamar a todas las variantes vendibles sin considerar estado del producto. |
| Existencias en `/stock/existencias` | Existe `apps/gestion/src/app/(app)/stock/page.tsx`, con `ExistenciasPage`; no hay página `stock/existencias` en el árbol inspeccionado. | Ruta correcta `/stock`; buscar Café y seleccionar Todos los depósitos. |
| Café en tres depósitos; Cargador sin filas de stock | seed:995–1060 inicia Café 90/15/20; ventas restan 6/1/4 (1756–1886); recepciones del seed suman 40+35 al Central (2320–2360). Cargador no recibe carga inicial (779–785). | Baseline calculado de Café: Central 159, Salón 14, Norte 16, solo para seed completo en base nueva sin otras operaciones. Comprobar ledger/proyección y filtro de Cargador; no mostrar las cantidades iniciales como saldo actual. Recepciones se mencionan solo para explicar el saldo, sin agregar Compras al recorrido. |
| Minorista fija; Mayorista -10%; Distribuidor -15%; Café 22.000 y Cuaderno 2.500 | seed:1143–1190 y 1244–1268 | Coherente. Café Mayorista esperado 19.800. Precios derivados se resuelven al leer. `ensureInitialPrice` (1092–1133) crea historial INITIAL, no una serie de aumentos. |
| 10 confirmadas + 1 borrador; próxima VTA-000012 | seed:1723–1926 añade DEMO-SEED-11 confirmado, además de 01–10 y DRAFT; 1599–1620 asigna número también al borrador. | 11 confirmadas + 1 borrador; 8 offsets distintos (0,1,2,3,4,6,8,9). En base nueva completa, próximas VTA-000013/14/15. Capturar siempre el número real. |
| Dos ventas hoy por 28.900; al terminar cinco por 75.400 | seed:1723–1752 y precios: 2×8.500+6.500=23.500; 3×1.200+2×900=5.400. DEMO-SEED-11 es de hace dos días. | Totales coherentes si seed y demo ocurren el mismo día local y nadie opera en paralelo: 2/28.900 → 3/50.900 → 4/72.900 → opcional 5/75.400. Sin venta opcional son cuatro, no cinco. |
| «Hoy» sigue siendo hoy aunque el seed se ejecutó hace tiempo; re-seed es no-op | seed:1526–1535 devuelve venta existente por companyId+notes; 1599 calcula fechas solo al crear. `dashboard.service.ts`:91–149 usa día local de empresa y confirmedAt. Los upserts de clientes (109–120) sí actualizan campos. | Fechas quedan ancladas a la primera creación; re-seed no rejuvenece ventas. Idempotencia significa ausencia de duplicados en los invariantes comprobados, no ausencia universal de escrituras. Registrar fecha/zona y no cruzar medianoche durante ensayo. |
| POS exige elegir Consumidor con F2 | `apps/facturacion/src/components/pos/default-customer.ts` y `pos-workspace.test.tsx` contienen resolución automática y caso de no reselección tras F2. `pos-keyboard.ts` maneja F2/F10. | Comprobar Consumidor Final por defecto; F2 solo para cambiar o resolver selección ausente. Atajos y foco pendientes de navegador. |
| Integración instantánea y comprobante | `sales.service.ts`:546–597 confirma en transacción, aplica `InventoryService.applySaleLine` y crea tender opcional; `print-receipt.tsx`:44 muestra «Documento interno. No constituye comprobante fiscal». | Misma venta entre apps, sin prometer refresco observado: recargar y comparar número/cliente/importe. Tender es metadato operativo; no demostrar ni afirmar un ingreso en Tesorería. |

## Recorrido corregido: 13 minutos (hasta 15 con la venta opcional)

Precondición: ensayo previo aprobado en entorno descartable, seed completo del mismo día de ANRAS, sin operadores concurrentes; Gestión y Facturación abiertas, sesión preparada. Si los saldos/precios difieren, detener el ensayo y registrar la diferencia, sin resetear una base existente.

1. **0:00–1:00, Gestión `/`**: elegir ANRAS/Casa Central y registrar baseline real. Explicar «ventas internas confirmadas»; expectativa condicional 2 / ARS 28.900.
2. **1:00–2:00, `/clientes`**: buscar Ferretería, abrir detalle; identificar Consumidor Final como uno de los 16 clientes, sin crear otro.
3. **2:00–3:30, `/productos`**: abrir Café; mostrar SKU. Señalar Buzo con variantes y Servicio de flete sin inventario. No crear productos.
4. **3:30–5:00, `/stock`**: buscar Café, mostrar tres depósitos y anotar el saldo del Central (esperado 159 en la base nueva). Abrir movimientos si hace falta explicar el saldo; no editarlo.
5. **5:00–6:00, `/listas-de-precios`**: Minorista, Café ARS 22.000; Mayorista ARS 19.800 como comparación. Volver a Minorista para vender.
6. **6:00–8:30, Facturación `/ventas/nueva`**: ANRAS/Casa Central/Depósito Central/Minorista; seleccionar Ferretería, Café ×1, verificar ARS 22.000 y confirmar la venta (incluido diálogo). Anotar número real; esperado VTA-000013 solo en la base limpia descrita.
7. **8:30–10:00, Gestión `/ventas` y `/stock`**: recargar; localizar ese número y contrastar cliente/total; stock Central baja exactamente 1 y existe movimiento SALE asociado. Dashboard esperado 3 / ARS 50.900.
8. **10:00–12:30, Facturación `/pos`**: verificar Consumidor Final, agregar Café ×1, F10, Efectivo, recibido 25.000 y vuelto 3.000; Confirmar y cobrar. Esperado siguiente número VTA-000014, stock Central 157 y dashboard 4 / ARS 72.900 tras recargar Gestión. Presentar tender como descripción operativa del pago; comprobante interno, nunca factura fiscal.
9. **12:30–13:00**: cerrar mostrando la misma venta entre apps y recordando que POS es un modo de Facturación. El guion termina dentro de ventas/productos/precios/stock/clientes.

Opcional **13:00–15:00**: Nueva venta POS, Cuaderno ×1, Tarjeta, ARS 2.500; sin integración con terminal bancaria. Comparar movimiento de Cuaderno -1 y dashboard 5 / ARS 75.400. Número esperado VTA-000015. No abrir Accounts/Treasury/Cobros/Pagos ni ampliar el cierre a esos módulos.

## Validación futura en base descartable (no ejecutada)

1. El coordinador autoriza entorno y ejecución en una tanda posterior, con PostgreSQL y Redis dedicados y sin datos existentes. Dependencias ya preparadas por ese owner; revisar resolución efectiva de DATABASE_URL/REDIS_URL en API, Prisma y suites, sin imprimir credenciales. No reutilizar `.env` de otra instalación. Aislar también los efectos del arranque normal del monolito; no modificarlos para la demo.
2. Aplicar migraciones existentes mediante `npm run db:migrate:deploy --workspace=apps/api`; no `db:reset`, ni generar migraciones. La autorización de esta fase no alcanza para ejecutar ese comando ahora.
3. Ejecutar `npm run db:seed` una vez. Registrar por empresa claves, IDs, conteos de clientes/productos/variantes/listas/precios/historial, marcadores de ventas, números, timestamps y totales; movimientos y proyección por variante/depósito. Comparar cálculos de la tabla, incluido 11 confirmadas + 1 borrador. Guardar evidencia sin secretos.
4. Ejecutar `npm run db:seed` por segunda vez en esa misma base descartable. Exigir que no se dupliquen esas entidades, marcadores, movimientos ni historial; IDs, números, timestamps de ventas, totales y saldos permanecen iguales. No exigir igualdad byte a byte de toda la base: los upserts pueden escribir campos. Si falla, registrar diferencia y pedir asignación separada al owner del seed; este plan no autoriza arreglarlo.
5. Con servicios locales preparados, `npm run dev`; ejecutar guion, capturar fecha/zona, números reales, comprobantes, dashboard y stock antes/después. Comprobar precio/descripcion como snapshot en el detalle y vínculo de cada SALE a su venta; volver a leer confirmada sin crear otro movimiento. El stock de otros depósitos no cambia por estas ventas del Central. No editar precios ni ventas confirmadas para demostrarlo.
6. Ejecutar suites sobre otra base descartable migrada con Redis dedicado, o retirar la demo antes de usarlas. Los e2e importan AppModule y hacen escrituras/limpieza de fixtures, no son consultas inocuas. No modificar sus helpers ni ampliar su alcance a áreas de ownership externo.

Comandos comprobados **por lectura de scripts**, no por ejecución; desde la raíz:

```sh
npm run lint
npm run typecheck
npm test
npm run test:facturacion
npm run test:gestion
npm run build
npm run test:e2e --workspace=apps/api -- --runInBand dashboard.e2e-spec.ts sales.e2e-spec.ts sale-integration.e2e-spec.ts
```

`package.json` define todos los scripts raíz; `apps/api/package.json` define migrate deploy y e2e con NODE_OPTIONS; las tres suites existen en `apps/api/test/`. Los tests de frontend usan Vitest. Los hooks prelint/pretypecheck/pretest/build generan paquetes; lint del API incluye `--fix`. Por eso no se ejecutaron en la primera tanda de un único archivo: la futura ejecución requiere worktree habilitado para artefactos y revisión del diff, sin arrastrar cambios fuera de allowlist. La presencia de suites no demuestra que pasen en esta base.

## Entrega documental y aceptación

Allowlist mínima propuesta inicialmente, **autorizada para la segunda etapa**: `docs/demo-guide.md` y `prompts/planned/015-demo-data-presentation-flow.md`. Corregir guía según tabla, retirar del guion las afirmaciones generales sobre módulos excluidos y sustituir el reset rutinario por preparación explícita de entorno descartable. No mover 015 a completed hasta registrar ensayo y decisión de cierre; ese movimiento requerirá ampliar allowlist al destino. No modificar código, seed ni pruebas para acomodar expectativas.

Propuestas al coordinador, sin edición de sus archivos:

- `docs/roadmap.md`, párrafo «Demo data / presentation flow» y fila 15: reemplazar «still open» indiferenciado por «dataset y guía implementados en e48fd0e; conciliación documental y nuevo ensayo pendientes».
- `docs/implementation-status.md`, cerca de Demo Dashboard / UX polish: agregar un estado específico para 015 con esa distinción, tres empresas accesibles y 11 ventas confirmadas + 1 borrador como expectativas del seed en esta base. Mantener separados los resultados históricos registrados y esta inspección estática de 2026-10-03; no renovar fechas o conteos de tests como si se hubieran ejecutado.
- No conciliar aquí estados de Accounts/Treasury/Cobros/Pagos. Cualquier corrección de esas secciones corresponde a su owner.

Criterios de aceptación del residual: nombres y rutas coinciden con base ensayada; no se promete múltiple historial de precios inexistente; doble seed conserva invariantes; guion dura 10–15 minutos; ventas coinciden entre apps y disminuyen stock por movimientos reales; totales se explican con fecha/zona y paso opcional; comprobante/tender se describen sin implicaciones fiscales ni de Tesorería; resultados de comandos y navegador quedan fechados con SHA. Si se necesita cambiar seed o dominio, detener esa parte y obtener nuevo ownership.

Verificación de esta preparación: lectura de AGENTS.md, orden D, workflow, estado, arquitectura, docs de Dashboard/Sales/Facturación/POS, roadmap y desarrollo; búsquedas dirigidas y revisión de scripts/código; HEAD y ancestro e48fd0e verificados. `git diff --check`, revisión de whitespace del archivo nuevo y `git status --short` verifican la entrega. No se ejecutaron instalaciones, tests, build, migraciones, seed, servidores ni conexiones DB/cloud; no hubo commits, push, PRs, merges ni comentarios externos.
