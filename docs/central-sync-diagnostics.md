# Diagnóstico de incorporación del catálogo

Este diagnóstico es el primer corte preparatorio de la sincronización
central/local de [task 020](../prompts/planned/020-central-and-branch-sync.md).
Compara dos archivos de catálogo y señala coincidencias que requieren
revisión, conflictos y referencias pendientes. No importa registros ni
activa replicación. No abre conexiones de red o base de datos ni arranca
NestJS. Todavía no está decidido si el primer local comenzará vacío o
conservará datos existentes; ambos escenarios se pueden ensayar.

## Ejecutar con datos sintéticos

Desde la raíz del repositorio, con las dependencias ya instaladas:

```sh
npm run build:api
node apps/api/dist/sync-diagnostics/cli.js \
  --central apps/api/test/fixtures/sync-diagnostics/central.json \
  --local apps/api/test/fixtures/sync-diagnostics/local-empty.json \
  --output /ruta/existente/reporte-local-vacio
```

El directorio final de salida **debe ser nuevo** y su padre debe existir.
Se generan `report.json` y `report.md`. Un directorio existente, incluso
vacío o un enlace simbólico, se rechaza sin sobrescribirlo. Los archivos
de entrada permanecen intactos. No se cargan variables de conexión ni
credenciales; no hace falta `.env` para ejecutar esta utilidad compilada.

Para ensayar un catálogo existente, usar `local-existing.json`. Para
validar asociaciones seleccionadas explícitamente, agregar:

```sh
--mappings apps/api/test/fixtures/sync-diagnostics/mappings.json
```

`local-conflict.json` cambia el tipo de un producto asociado de PRODUCT a
SERVICE; junto con ese archivo de correspondencias debe señalar conflicto.
Los fixtures son inventados y no son exportaciones de una empresa real.
La herramienta no incluye un exportador ni valida la procedencia/autorización
de un archivo: recibir JSON no da acceso a ninguna empresa en el ERP.

## Entradas y límites

Cada catálogo contiene `version: 1`, `installationId`, `companyId`,
`capturedAt` (fecha ISO con zona) y seis colecciones obligatorias:

| Colección | Campos por registro |
| --- | --- |
| `units` | `id`, `code` |
| `lines` | `id`, `name` |
| `categories` | `id`, `name`, `parentId` nullable |
| `products` | `id`, `code`, `name`, `type`, `active`, `unitId`, `lineId`/`categoryId` nullable |
| `variants` | `id`, `productId`, `sku` nullable, `active` |
| `codes` | `id`, `variantId`, `type`, `code`, `active` |

`type` de producto admite PRODUCT, SERVICE, KIT y MANUFACTURED. El de código
admite BARCODE, SUPPLIER, INTERNAL, MARKETPLACE y OTHER. `active` es la
proyección booleana del estado del registro en este formato de diagnóstico;
no es un nuevo contrato del API. Las referencias pertenecen al mismo archivo.
Un local vacío se representa con las seis colecciones vacías, nunca con un
archivo faltante. Los IDs son opacos y locales a cada instalación.

Los objetos son estrictos: campos adicionales, incluidos precios, stock,
clientes o transacciones, se rechazan. La CLI admite archivos regulares de
hasta 10 MiB, con lectura limitada; cada colección y el conjunto de
correspondencias admiten hasta 5.000 registros; no consume dispositivos ni pipes. No
imprime contenido de entradas ni errores internos del parser.

Las correspondencias opcionales tienen `version: 1`, scopes `central` y
`local` (cada uno con `installationId` y `companyId` exactos) y `entries`:

```json
{
  "entity": "product",
  "centralId": "c-product",
  "localId": "l-product"
}
```

Tipos de entidad: `unit`, `line`, `category`, `product`, `variant`, `code`.
Una correspondencia es una selección a comprobar, no una autorización para
adoptar datos. IDs iguales entre archivos, nombres iguales o códigos iguales
nunca crean asociaciones automáticas. Las referencias también deben tener
correspondencias explícitas consistentes; no se infieren por etiqueta.

## Reglas y resultados

El analizador inspecciona IDs duplicados, referencias ausentes y ciclos de
categorías antes de comparar. Las reglas de unicidad siguen la implementación
actual de Productos:

- Código de producto y unidad: únicos dentro del catálogo/empresa, incluyendo
  registros inactivos cuando corresponde.
- SKU: único entre variantes activas; no se ignora una variante activa por
  tener su producto inactivo.
- Barcode: único entre códigos BARCODE activos; los otros tipos no son
  globalmente únicos. Se conservan ceros iniciales.
- Línea: nombre normalizado con trim y minúsculas para detectar duplicados.
  Esto verifica unicidad dentro de una instalación, no identidad entre ellas.
- Nombres de categorías no son claves únicas ni sirven para asociar entidades.

Códigos/SKU se comparan como strings normalizados según las reglas de entrada;
no se convierten a números. La comparación distingue mayúsculas donde lo
hace la verificación de unicidad del servicio. Los campos fuera de esta
proyección, como atributos de variantes o conversiones de unidades, no se
evalúan: un resultado consistente no certifica equivalencia comercial total.

Los hallazgos indican severidad, entidad, IDs, campo, motivo y acción sugerida.
El orden es estable, independiente del orden de registros en los archivos.
El reporte identifica los scopes y fechas de captura de ambas fuentes
cuando son válidas, sin incluir una fecha de ejecución variable. Dos
catálogos con el mismo identificador de instalación se rechazan. Se distingue:

| Estado / código de salida | Significado |
| --- | --- |
| `clear` / 0 | Sin conflictos ni revisiones pendientes dentro de esta proyección |
| `review-required` / 1 | Coincidencias, registros exclusivos o referencias por revisar |
| `invalid-input` / 2 | Formato, referencias o scopes inválidos; diagnóstico no fiable |
| `conflicts` / 3 | Conflictos encontrados en los datos/asociaciones válidos |
| error de CLI / 4 | Argumentos, lectura/JSON o escritura fallidos; no se comunica éxito |

`clear` **no significa listo para sincronizar**. El diagnóstico no asigna
identidad global, no adopta maestros ni modifica sus IDs. Repetirlo produce
el mismo resultado para las mismas entradas. Un error de lectura no se trata
como un catálogo vacío; un reporte previo no se reutiliza como éxito.

## Verificación y próximos cortes

Pruebas del analizador: conflictos, referencias, ciclos, asociaciones
contradictorias, campos prohibidos y determinismo. Pruebas de CLI: protección
de entradas/reportes existentes, fallos de lectura/tamaño, estados de salida
y generación de reportes. La verificación final y el estado de entrega se
registran en [task 026](../prompts/planned/026-catalog-adoption-diagnostic.md).

Identidad global, protección de escritura local, credenciales de máquinas,
feeds, aplicación de lotes, precios/clientes, stock remoto y despliegue real
siguen pendientes. No hay cambios a Prisma/migraciones, seed, contratos
compartidos, autenticación/contexto/autorización/auditoría ni configuración
raíz. El PR requiere revisión humana y no se mergea automáticamente.
