# Task 026 — Diagnóstico de incorporación de catálogo

Status: IMPLEMENTED ON REVIEW BRANCH — offline diagnostic only
Owner: Codex coordinator; analyzer/tests delegated to one bounded worker
Base branch: main @ bad032f (PR #63 merged)
Branch: agent/codex-catalog-diagnostic
Dependencies: task 020 deployment decisions; no unmerged code dependencies
PR: pending

Ownership: worker owns analyzer.ts and analyzer.spec.ts under
apps/api/src/sync-diagnostics/. Coordinator owns CLI/CLI tests, synthetic
fixtures, module documentation and status/roadmap. Neither changes Prisma,
migrations, seed, shared/auth-client, auth/context/authorization/audit or
root configuration. All artifacts share the same isolated worktree and
branch with disjoint files; no parallel owners of sensitive surfaces.

Verification: API lint (--no-fix), typecheck, unit tests and production
build; real CLI smoke runs on synthetic files including invalid input,
conflicts and empty local catalog. No database/network needed.

**Estado:** implementación y verificación local completadas; revisión humana y merge pendientes. **Fecha:** 2026-10-03.

Antes de sincronizar, necesitamos saber si los productos de la central y de cada local representan los mismos artículos y qué diferencias requieren revisión. Este primer corte entrega un diagnóstico reproducible: no importa datos, no cambia registros y no activa sincronización.

Todavía no está decidido si el primer local comenzará vacío o conservará un catálogo existente. **Esa decisión no bloquea este diagnóstico:** se prueban ambos escenarios con datos inventados. Sí deberá resolverse antes de incorporar un local real.

## Alcance y responsable

Un único responsable implementa la tarea en una rama dedicada, creada desde `main` actualizado. Lee primero `AGENTS.md`, `docs/multi-agent-workflow.md`, `docs/deployment-model.md` y el código de Productos.

Incluye exclusivamente productos, variantes, códigos alternativos y sus referencias de catálogo: unidades de medida, líneas y categorías, incluidas sus relaciones padre/hijo. Excluye clientes, listas de precios, precios, existencias, movimientos, documentos comerciales y datos financieros.

Archivos previstos: un analizador y sus pruebas bajo `apps/api/src/sync-diagnostics/`, fixtures sintéticos bajo `apps/api/test/fixtures/sync-diagnostics/` y `docs/central-sync-diagnostics.md`. Será una utilidad sin endpoints ni conexión a bases. Debe poder ejecutarse con el entorno de desarrollo existente; no agregar dependencias ni modificar configuración raíz para este corte.

Prisma/migraciones, seed, `packages/shared`, `packages/auth-client`, auth, company-context, authorization, audit y configuración raíz permanecen reservados al coordinador. Si una necesidad futura afecta estas áreas, se asigna un solo responsable y se ordena el trabajo; no se abren implementaciones simultáneas sobre ellas.

## Entradas

Dos archivos JSON sintéticos: catálogo de la central y catálogo de un local. Cada archivo declara versión del formato, identificador de instalación, empresa de origen y fecha de la captura. El local vacío se representa con colecciones vacías; un archivo ausente o inválido nunca equivale a un local vacío.

Cada registro conserva su identificador de origen y las referencias mediante identificadores del mismo archivo. Campos permitidos:

- Producto: ID, código, nombre para lectura humana, tipo, estado y referencias a unidad, línea y categoría.
- Variante: ID, producto de origen, SKU opcional y estado.
- Código alternativo: ID, variante, tipo y valor.
- Unidad: ID y código; línea/categoría: ID y etiqueta visible; categoría: padre opcional.

Los identificadores son locales a su instalación: dos IDs iguales en archivos diferentes **no prueban identidad compartida**. Los nombres sirven únicamente para mostrar el reporte, nunca como claves de asociación. La igualdad de códigos tampoco confirma una correspondencia por sí sola.

Se admite un tercer archivo opcional de correspondencias explícitas para el ensayo: tipo de entidad, ID central e ID local. Solo expresa una selección a validar; no adopta registros ni crea una identidad global. Sin correspondencia explícita para una línea o categoría, el resultado queda pendiente. El analizador rechaza referencias inexistentes, asociaciones de tipos distintos y asociaciones múltiples incompatibles.

## Procesamiento y reporte

El analizador valida primero formato, IDs duplicados, relaciones, ciclos de categorías y reglas de unicidad. Las reglas de códigos/SKU/barcodes, normalización y estado activo deben obtenerse de la implementación actual de Productos; documentar cuáles se aplican, sin inventar reglas universales.

Después genera JSON y un resumen Markdown con totales y hallazgos ordenados de forma estable. Cada hallazgo contiene severidad, entidad, identificadores de ambos lados cuando existan, campo implicado, motivo y acción sugerida. Clasificaciones mínimas:

- **Entrada inválida:** no se puede evaluar de manera fiable.
- **Correspondencia explícita consistente:** los IDs y sus relaciones pasan las validaciones; no implica autorización para importar.
- **Coincidencia por revisar:** código, SKU o barcode coincidente, todavía sin asociación confirmada.
- **Conflicto:** claves reutilizadas, asociaciones contradictorias o referencias incompatibles.
- **Solo central / solo local:** registros sin correspondencia, que pueden requerir incorporación o una decisión posterior.
- **Referencia pendiente:** falta identificar una unidad, línea, categoría o producto padre.

El reporte describe diferencias sin renumerar códigos, fusionar productos, borrar filas ni sugerir que «sin conflictos» significa «listo para sincronizar». Para un local vacío informa cuántas entidades habría que incorporar y sus dependencias. No serializa campos adicionales ni vuelca entradas completas en logs.

## Criterios de aceptación y verificación

1. La ejecución no abre conexiones de red o base de datos y no modifica los archivos de entrada. Solo escribe los reportes en el destino indicado.
2. La misma entrada produce el mismo diagnóstico y orden de resultados. Una fecha de ejecución, si se incluye, queda separada de los resultados comparables.
3. Las pruebas cubren local vacío, catálogo existente, IDs iguales entre instalaciones, nombres iguales sin asociación, códigos/SKU/barcodes en conflicto, estados activos/inactivos, referencias ausentes, ciclos y correspondencias explícitas contradictorias.
4. No se incluyen clientes, precios, stock ni transacciones. Campos desconocidos se rechazan para evitar incorporarlos inadvertidamente.
5. El resultado distingue fallo de lectura/formato, diagnóstico con conflictos y diagnóstico sin conflictos; un fallo nunca produce un reporte de éxito.
6. Se ejecutan lint, chequeo de tipos, pruebas relevantes y build exigidos por el repositorio. La documentación explica entradas, ejecución, resultados y limitaciones con ejemplos sintéticos.

La entrega será un PR pequeño para revisión humana. No habrá merge automático ni cambios al PR #17. El próximo corte, después de revisar este diagnóstico, podrá definir identidad estable y protección contra edición local de registros replicados; transporte, credenciales y despliegue quedan para tareas posteriores.


## Entrega y verificación ejecutada

- Analizador puro, CLI y cinco fixtures sintéticos implementados, sin conexión
  a red/base ni importación. Reportes JSON/Markdown con scopes de procedencia.
- `npm run lint --workspace=apps/api -- --no-fix`: PASS.
- `npm run typecheck --workspace=apps/api`: PASS.
- `npm test --workspace=apps/api -- --runInBand`: PASS, 142 tests
  (114 existentes + 18 del analizador + 10 de CLI).
- `npm run build --workspace=apps/api`: PASS.
- CLI compilada, sin variables de conexión: local vacío y existente sin
  asociaciones devuelven revisión (1); asociaciones completas consistentes,
  claro (0); tipo incompatible asociado, conflicto (3); campo no permitido,
  entrada inválida (2); archivo faltante, error (4). Hashes de fixtures intactos.
- Segunda revisión independiente: corregidos orden de correspondencias
  contradictorias, grafos con IDs duplicados y propagación de conflictos a
  dependientes antes de declarar consistencia. Sin hallazgos pendientes en
  el alcance revisado. Determinismo, límites y Markdown escapado tienen pruebas.
- `git diff --check` y enlaces relativos: PASS.

No se ejecutaron migraciones ni seed: no cambiaron esquema o base. No se
hizo ensayo con catálogos reales ni validación de réplica. Los resultados
solo cubren la proyección documentada; faltan atributos de variantes,
conversiones de unidades y futuras reglas de adopción. Los reportes no
habilitan importación aunque el estado sea clear. PR #17 sigue intacto;
ningún agente realiza merges.
