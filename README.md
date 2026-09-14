# ERP Platform

Un ERP para PyMEs argentinas, pensado para instalarse **en la empresa** y no
en la nube: un servidor en el local del cliente, y todas las demás
computadoras trabajando contra él por la red interna.

Son **dos productos con una sola base de datos y una sola lógica de
negocio**: **Gestión**, el escritorio administrativo, y **Facturación**, la
pantalla rápida del mostrador, con un modo POS adentro. No son dos sistemas
que se sincronizan: son dos interfaces del mismo sistema, y esa es la
decisión de diseño de la que dependen casi todas las demás.

> **Estado del proyecto:** el circuito comercial está completo y funcionando
> (clientes, productos, stock, precios, ventas, compras, cuentas corrientes,
> cobros y pagos). Lo fiscal —facturación electrónica, ARCA, IVA— **no está
> implementado**. El detalle verificado, módulo por módulo, está en
> [docs/implementation-status.md](docs/implementation-status.md), que es la
> fuente de verdad si algo de este README quedara desactualizado.

---

## Qué problema resuelve

Una PyME que hoy trabaja con Tango, con planillas, o con un sistema viejo que
nadie mantiene, necesita cuatro cosas al mismo tiempo:

1. **Vender rápido en el mostrador.** Buscar un producto por nombre o código
   de barras, ver el precio y si hay stock, cobrar, y que el stock baje solo.
2. **Que la administración vea lo mismo que el mostrador**, en el momento, sin
   exportar ni importar nada.
3. **No perder la historia.** Cuánto había, quién lo movió, con qué precio se
   vendió, cuánto debe cada cliente.
4. **Que funcione aunque se caiga internet.** Un negocio no puede dejar de
   facturar porque se cortó el servicio del proveedor.

El punto 4 es el que define la arquitectura entera, y está explicado más
abajo en "Cómo se despliega".

## Los dos productos

La separación no es estética. Son dos ritmos de trabajo distintos, y mezclarlos
produce una pantalla que no sirve para ninguno de los dos.

### Gestión — el escritorio administrativo

Para quien carga productos, revisa stock, ajusta precios, mira qué debe cada
cliente y administra usuarios. Prioriza **claridad sobre velocidad**: pantallas
que revelan la información de a poco, en vez de una sola pantalla enorme que
hace todo.

Incluye: clientes, productos, stock y depósitos, listas de precios, ventas,
proveedores y compras, cuentas corrientes, cobros y pagos, y la administración
de roles, usuarios, auditoría y backups.

### Facturación — el mostrador

Para quien atiende. Prioriza **velocidad y teclado**: la menor cantidad de
clics posible, atajos como ciudadanos de primera, y respuesta inmediata.
Adentro tiene un **modo POS** todavía más rápido, pensado para una caja: se
carga el carrito, se elige forma de pago, se confirma.

Facturación **no administra** clientes ni productos: los consume. El alta de
maestros vive en Gestión, a propósito, para que no existan dos caminos para
crear la misma cosa.

El razonamiento completo de esta división está en
[docs/product-ui-principles.md](docs/product-ui-principles.md).

## Cómo se despliega

**Local-first, cloud-ready.** Primero funciona local; el mismo núcleo tiene que
poder desplegarse en la nube más adelante sin reescribir módulos.

```
        ┌──────────────────────────────────────────┐
        │  Servidor en el local del cliente        │
        │                                          │
        │   PostgreSQL  ←  API única  →  Realtime  │
        │                    ↑                     │
        │        Gestión ────┴──── Facturación     │
        └──────────────────────────────────────────┘
                             ↑ red interna (LAN)
              ┌──────────────┼──────────────┐
          PC mostrador   PC depósito   PC administración
          (ERP.exe o navegador)
```

- **Una sola máquina corre todo**: PostgreSQL, la API y las dos aplicaciones
  web, cada una como un servicio de Windows supervisado.
- **Las demás PC son clientes finos**: un ejecutable Electron (`ERP.exe`) o
  directamente el navegador, apuntando al servidor por la red interna.
- **Los clientes nunca hablan con PostgreSQL.** Siempre pasan por la API.
- **El realtime es solo una señal de invalidación**: avisa "esto cambió" para
  que las pantallas se refresquen. La verdad siempre vuelve por REST desde
  PostgreSQL, nunca viaja por el socket.

Detalle: [docs/desktop-lan-architecture.md](docs/desktop-lan-architecture.md).

### Instalación en el cliente

Hay un instalador de Windows autocontenido (`ERPServerSetup-*.exe`) que trae
Node, PostgreSQL y las dos aplicaciones ya compiladas, registra los cinco
servicios y crea una empresa vacía con su administrador — **no** los datos de
demostración.

> **Honestidad sobre el instalador:** compila y el payload ya incluye
> PostgreSQL, pero **nunca se ejecutó en ninguna máquina**. Producir un
> instalador y instalar con él son dos afirmaciones distintas, y hoy solo la
> primera es cierta. La primera instalación en una PC Windows limpia es
> trabajo pendiente, no un trámite. Ver
> [docs/server-installer.md](docs/server-installer.md).

## Estado actual

| Área | Estado | Nota |
| --- | --- | --- |
| Autenticación, multiempresa, permisos, auditoría | ✅ | Núcleo transversal |
| Clientes | ✅ | Con CUIT/documento, domicilios, contactos, categorías |
| Productos | ✅ | Catálogo con variantes, códigos de barras, categorías, líneas |
| Inventario | ✅ | Ledger de movimientos, depósitos, ajustes y **transferencias** |
| Listas de precios | ✅ | Fijas y derivadas, con historial de precios |
| Ventas | ✅ | Documento interno, **no** factura fiscal |
| Facturación + POS | ✅ | Mismo dominio de ventas, no una implementación paralela |
| Compras | ✅ | Proveedores, órdenes de compra, recepciones |
| Cuentas corrientes, cobros y pagos | ✅ | Dos ledgers inmutables, de clientes y de proveedores |
| Tablero de inicio | ✅ | Agregados de solo lectura, sin reglas duplicadas |
| Realtime LAN | ✅ | Solo invalidación, después del commit |
| Cliente Electron | ✅ | Cliente fino configurable |
| Backups y restore | ✅ | Agente propio, verifica cada copia releyéndola |
| Instalador Windows | 🟡 | Compila e incluye PostgreSQL; **nunca instalado** |
| Tesorería | ⚪ | Caja, bancos, conciliación |
| Fiscal / ARCA | ⚪ | Facturas fiscales, CAE, IVA, notas de crédito y débito |
| Contabilidad | ⚪ | Plan de cuentas, asientos |
| Reporting avanzado | ⚪ | Exportaciones, tableros configurables |

Estado verificado y detallado:
[docs/implementation-status.md](docs/implementation-status.md).
Plan por fases: [docs/roadmap.md](docs/roadmap.md).

## Principios que no se negocian

Estas reglas explican por qué el código está escrito como está. No son
preferencias de estilo: cada una evita una clase concreta de error que en un
ERP cuesta plata real.

- **Ledgers inmutables.** El stock y los saldos de cuenta corriente son la
  suma de movimientos, nunca una columna que alguien actualiza. Corregir un
  error se hace **agregando** un movimiento compensatorio, jamás editando o
  borrando el anterior. Los saldos que ves en pantalla son una proyección
  reconstruible: si alguna vez discrepan del ledger, gana el ledger.
- **`Decimal`, nunca punto flotante**, para plata y cantidades. Un centavo
  perdido por redondeo binario aparece meses después en una conciliación.
- **Aislamiento estricto por empresa.** Toda consulta filtra por `companyId`.
  Un recurso de otra empresa responde *no encontrado*, nunca *no es tuyo* —
  la respuesta no revela siquiera que existe.
- **Permisos declarados en la ruta**, verificados en el servidor. Lo que hace
  el frontend con los permisos es solo experiencia de usuario: cada operación
  se vuelve a controlar del lado del servidor.
- **Estados explícitos y transacciones atómicas.** Confirmar una venta mueve
  stock, cambia el estado y escribe auditoría dentro de una sola transacción:
  pasa todo o no pasa nada.
- **Concurrencia real.** Dos cajas vendiendo el mismo producto al mismo tiempo
  es el caso normal, no el excepcional. Las confirmaciones usan un `UPDATE`
  condicional sobre el estado, así que confirmar dos veces es *imposible*, no
  simplemente improbable.
- **Auditoría de acciones de negocio**, no de filas de base de datos. Guardar
  el permiso de un rol es **un** registro de cambio de permisos, no N filas
  por N cambios en una tabla intermedia.

## Arquitectura

Monolito modular en el backend (no microservicios), con **dos frontends
separados** que comparten la misma API, la misma autenticación, la misma base
y el mismo dominio.

| Capa | Tecnología |
| --- | --- |
| API | NestJS + Prisma + PostgreSQL 16 |
| Caché (opcional) | Redis 7 |
| Frontends | Next.js (Gestión y Facturación) |
| Estado y datos en el cliente | TanStack Query |
| Contratos compartidos | Zod, en `packages/shared` |
| Cliente de escritorio | Electron (`apps/desktop`) |
| Agente de mantenimiento | `apps/server-agent` (backups) |

Redis es **genuinamente opcional**: si no está, la API arranca igual y reporta
`degraded`. Los permisos se recalculan desde PostgreSQL ante cualquier error de
caché — corrección antes que conveniencia.

Mapa completo del repositorio y diagrama:
[docs/architecture.md](docs/architecture.md).

---

## Puesta en marcha

### Requisitos

- Node.js ≥ 20
- npm (el monorepo usa workspaces; no hace falta pnpm ni yarn)
- PostgreSQL 16 y Redis 7, con Docker o instalados localmente

### Instalación

```bash
npm install
cp .env.example apps/api/.env               # editá apps/api/.env si hace falta
cp .env.example apps/gestion/.env.local      # solo overrides NEXT_PUBLIC_*
cp .env.example apps/facturacion/.env.local  # ídem
```

### Infraestructura con Docker

```bash
docker compose up -d   # levanta postgres (:5433) y redis (:6380)
```

`.env.example` ya viene apuntando a esos puertos.

### Infraestructura sin Docker

Instalá PostgreSQL 16 y Redis localmente (por ejemplo
`brew install postgresql@16 redis`) y apuntá `DATABASE_URL` y `REDIS_URL` de
`apps/api/.env` a tus instancias. Funcionalmente equivalente.

### Base de datos

```bash
npm run db:migrate   # aplica las migraciones sobre una base vacía
npm run db:seed      # datos de demostración (ver abajo)
npm run db:studio    # Prisma Studio
```

### Levantar todo

```bash
npm run dev             # api (:3001) + gestion (:3000) + facturacion (:3002)
npm run dev:api
npm run dev:gestion
npm run dev:facturacion
```

## Puertos

| Aplicación | Puerto | URL |
| --- | --- | --- |
| `apps/api` | `3001` | `http://localhost:3001/api/v1` |
| `apps/gestion` | `3000` | `http://localhost:3000` |
| `apps/facturacion` | `3002` | `http://localhost:3002` |

Puertos distintos de `localhost` cuentan como el mismo "sitio" para las
cookies del navegador, así que la sesión se comparte entre las tres
aplicaciones en desarrollo sin configuración extra.

En producción, Gestión y Facturación resuelven la dirección de la API **en
tiempo de ejecución** a partir del host desde el que se cargó la página: abrir
Gestión en `192.168.1.50:3000` hace que busque la API en `192.168.1.50:3001`,
sin recompilar nada.

## Variables de entorno

Definidas y validadas en `packages/config/src/env.ts`. La aplicación **no
arranca** si falta alguna obligatoria o si está mal formada.

| Variable | Obligatoria | Default | Notas |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `API_PORT` | no | `3001` | |
| `DATABASE_URL` | **sí** | — | Cadena de conexión a PostgreSQL |
| `REDIS_URL` | **sí** | — | Cadena de conexión a Redis |
| `CORS_ORIGIN` | no | `http://localhost:3000,http://localhost:3002` | Orígenes permitidos, separados por coma |
| `LOG_LEVEL` | no | `info` | Nivel de pino |
| `AUTH_ACCESS_TOKEN_SECRET` | en prod: **sí** | default de desarrollo | Firma los JWT; la app rechaza el default en producción |
| `AUTH_ACCESS_TOKEN_TTL` | no | `15m` | |
| `AUTH_REFRESH_TOKEN_TTL` | no | `30d` | |
| `AUTH_COOKIE_DOMAIN` | no | sin definir | Dejalo sin definir en desarrollo; en producción, un dominio real |
| `AUTH_COOKIE_SECURE` | no | `false` | `true` en cualquier despliegue con HTTPS |
| `AUTH_RATE_LIMIT_TTL_SECONDS` / `AUTH_RATE_LIMIT_MAX` | no | `60` / `10` | Límite de intentos en login y recuperación de contraseña |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | en prod: **sí** | default de desarrollo | Solo los lee `npm run db:seed`, nunca la API en ejecución |

`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GESTION_URL` y
`NEXT_PUBLIC_FACTURACION_URL` existen solo como override explícito para
desarrollo y pruebas.

## Datos de demostración

`npm run db:seed` es **idempotente**: se puede volver a correr sin duplicar
nada, y rota la contraseña del administrador si cambió `SEED_ADMIN_PASSWORD`.
Crea:

- **Tres empresas** (ANRAS, CABACO, BLANCO BAHIA) bajo un mismo tenant, con un
  administrador que accede a las tres — así el selector de empresa y el
  aislamiento entre empresas se pueden probar de verdad.
- El **catálogo completo de permisos** y los **8 roles de sistema** por empresa
  (Administrador, Gerente, Ventas, Depósito, Compras, Tesorería, Contabilidad,
  Solo lectura).
- En ANRAS: 16 clientes (incluido Consumidor Final y uno inactivo), 17
  productos / 21 variantes vendibles (uno con variantes, tres servicios, uno
  sin stock), 3 depósitos con stock inicial cargado como movimientos reales,
  3 monedas y 3 listas de precios (una fija y dos derivadas), 5 proveedores,
  4 órdenes de compra y 4 recepciones, 11 ventas confirmadas a lo largo de 8
  días, y el ledger de cuentas corrientes con cobros y pagos.

El stock, los precios y los saldos del seed se crean **a través de las mismas
operaciones que usa el producto**, no insertando filas a mano: los datos de
demostración son datos reales de un sistema real.

> El instalador **no** usa este seed. Un cliente que paga no puede abrir el
> sistema por primera vez y encontrar el negocio inventado de otro. Ver
> "Por qué el provisioning no es el seed" en
> [docs/server-installer.md](docs/server-installer.md).

---

## Módulos y API

Todos los endpoints cuelgan de `/api/v1`. Las rutas con alcance de empresa
llevan la cabecera `X-Company-Id` (y opcionalmente `X-Branch-Id`), que el
cliente compartido adjunta solo una vez elegida la empresa.

### Autenticación

Argon2id para las contraseñas; JWT de vida corta en cookie `httpOnly`, más
sesiones de refresco rotatorias guardadas del lado del servidor (el token se
guarda hasheado, nunca en crudo).

| Endpoint | Notas |
| --- | --- |
| `POST /auth/login` | Con límite de intentos; error genérico ante credenciales inválidas |
| `POST /auth/refresh` | Rota la sesión |
| `POST /auth/logout` · `logout-all` | Revoca una sesión o todas |
| `GET /auth/me` | Identidad solamente |
| `POST /auth/change-password` | Exige la contraseña actual |
| `POST /auth/forgot-password` | Siempre responde éxito, para no revelar qué emails existen |
| `POST /auth/reset-password` | Consume el token y revoca todas las sesiones |

### Contexto de empresa

Autenticación responde "quién", el contexto responde "en qué empresa", y los
permisos responden "qué puede hacer ahí". Son tres mecanismos separados a
propósito. Ver
[docs/multi-company-architecture.md](docs/multi-company-architecture.md).

| Endpoint | Notas |
| --- | --- |
| `GET /context/companies` | Empresas accesibles para el usuario |
| `GET /context/companies/:id/branches` | Sucursales activas |
| `GET /context/permissions` | Permisos efectivos en la empresa activa |

### Administración, roles y auditoría

Ver [docs/authorization.md](docs/authorization.md) y
[docs/audit-architecture.md](docs/audit-architecture.md).

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `/administration/roles` | `administration.roles.*` | Baja lógica, nunca borrado real |
| `PUT /administration/roles/:id/permissions` | `administration.roles.update` | Reemplazo atómico |
| `/administration/users` | `administration.users.*` | Alta de usuarios y asignación de roles |
| `DELETE .../users/:id/roles/:roleId` | `administration.roles.assign` | Se niega a dejar la empresa sin administrador |
| `GET /administration/audit` | `administration.audit.read` | Solo lectura por construcción |

### Clientes · [docs/customers.md](docs/customers.md)

Sin columna de saldo: el saldo se deriva del ledger de cuenta corriente.

| Endpoint | Permiso |
| --- | --- |
| `GET /customers` · `/customers/lookup` | `customers.read` |
| `POST /customers` | `customers.create` |
| `PATCH /customers/:id` | `customers.update` |
| `POST /customers/:id/(de)activate` | `customers.deactivate` |
| `/customer-categories`, `.../addresses`, `.../contacts` | según acción |

### Productos · [docs/products.md](docs/products.md)

`Product` responde "qué es el artículo", nunca "cuántos hay", "cuánto sale" ni
"cuánto costó".

| Endpoint | Permiso |
| --- | --- |
| `GET /products` · `/products/lookup` | `products.read` |
| `POST /products` | `products.create` |
| `PATCH /products/:id` | `products.update` |
| `/product-categories`, `/product-lines`, `/units` | según acción |

### Inventario · [docs/inventory.md](docs/inventory.md)

`StockMovement` es la única fuente autoritativa; `InventoryBalance` es una
proyección reconstruible.

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET /inventory/stock` | `inventory.stock.read` | Físico / Reservado / Disponible |
| `GET /inventory/lookup` | `inventory.stock.read` | Búsqueda con precio y disponibilidad |
| `GET /inventory/movements` | `inventory.movements.read` | Ledger inmutable |
| `/inventory/adjustments` | `inventory.adjustments.*` | Borrador; solo confirmar mueve stock |
| `/inventory/transfers` | `inventory.transfers.*` | Entre dos depósitos, con salida y entrada en una transacción |
| `POST /inventory/transfers/:id/cancel` | `inventory.transfers.cancel` | Genera movimientos compensatorios |
| `/warehouses` | `inventory.warehouses.*` | Baja rechazada si queda stock |

### Precios · [docs/pricing.md](docs/pricing.md)

Las listas FIJAS guardan precios explícitos; las DERIVADAS se calculan al leer
desde otra lista más un ajuste, y nunca se materializan.

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `/pricing/lists` | `pricing.lists.*` | |
| `PUT /pricing/lists/:id/prices` | `pricing.prices.update` | Alta masiva transaccional |
| `POST /pricing/lists/:id/bulk-adjust(/preview)` | `pricing.prices.bulk_update` | La vista previa no escribe nada |
| `GET /pricing/lookup` | `pricing.prices.read` | Nunca devuelve 0 por un precio faltante |

### Ventas · [docs/sales.md](docs/sales.md)

Un solo tipo de documento (`SALE`), **que no es una factura fiscal**. El precio
y la descripción de cada línea se resuelven una vez y quedan congelados.

| Endpoint | Permiso | Notas |
| --- | --- | --- |
| `GET/POST /sales` | `sales.documents.read`/`create` | |
| `POST /sales/:id/confirm` | `sales.documents.confirm` | Atómico e idempotente; acepta la forma de pago del POS |
| `POST /sales/:id/cancel` | `sales.documents.cancel` | Solo borradores |

Facturación y el POS llaman a este mismo servicio, no a una implementación
paralela. Ver [docs/facturacion.md](docs/facturacion.md) y
[docs/pos.md](docs/pos.md).

### Compras · [docs/purchases.md](docs/purchases.md)

Proveedores, órdenes de compra y recepciones de mercadería. La recepción es la
que mueve stock, no la orden.

### Cuentas corrientes · [docs/current-accounts.md](docs/current-accounts.md)

Dos ledgers inmutables —clientes y proveedores— más los documentos de cobro y
de pago con su máquina de estados. Ningún saldo se guarda como columna.

---

## Tests

```bash
npm test                  # unitarios de la API, con dependencias simuladas
npm run test:e2e          # e2e de la API, contra PostgreSQL y Redis reales
npm run test:gestion      # componentes y lógica de Gestión
npm run test:facturacion  # componentes y lógica de Facturación
npm run test:server-agent # agente de backups
```

Los e2e no simulan nada en la capa de base de datos: necesitan un PostgreSQL y
un Redis de verdad. Crean su propio tenant y empresa por corrida, así que no
dependen del seed.

## Controles de calidad

```bash
npm run lint
npm run typecheck
npm run format        # escribe
npm run format:check  # solo verifica
npm run build         # api + gestion + facturacion
```

CI corre lint, typecheck, migraciones, seed, unitarios, e2e y build en cada
Pull Request.

## Estructura del proyecto

```
apps/
  api/           NestJS: la única entrada a los datos
    src/
      auth/               login, refresco, contraseñas
      company-context/    guardas de X-Company-Id / X-Branch-Id
      authorization/      @RequirePermissions() y cálculo de permisos
      audit/              registro de acciones de negocio
      customers/  products/  warehouses/  inventory/  pricing/
      sales/  purchases/  accounts/  dashboard/
      realtime/           invalidación por WebSocket, después del commit
      system/             estado del servidor y de los backups, solo lectura
      health/  redis/  database/  config/
    prisma/       schema.prisma, migraciones, seed.ts y provision.ts
  gestion/       Next.js — escritorio administrativo
  facturacion/   Next.js — mostrador y POS
  desktop/       Electron — cliente fino para la red interna
  server-agent/  Agente de backups, servicio de Windows aparte

packages/
  shared/        Contratos Zod, tipos y catálogo de permisos
  auth-client/   Cliente HTTP y hooks de TanStack Query compartidos
  config/        Validación de variables de entorno
  eslint-config/  typescript-config/

infrastructure/windows/   Instalador: payload, servicios WinSW, scripts
docs/                     Documentación técnica — ver docs/README.md
prompts/                  Especificaciones de tareas — ver prompts/README.md
.github/                  CI, plantillas de PR e issues
```

## Documentación

Empezá por [AGENTS.md](AGENTS.md): son las reglas compartidas para cualquiera
que escriba código acá, sea persona o agente. Después,
[docs/README.md](docs/README.md) tiene el índice completo: arquitectura,
estado de implementación, roadmap, flujo de trabajo y un documento por módulo.

`CLAUDE.md` complementa `AGENTS.md` con detalle específico para Claude Code.

**El código, los tests y la documentación del repositorio son la fuente de
verdad** — no este README, y no el historial de conversación de ningún agente.
Si encontrás una contradicción, gana el código, y corregir el documento es
parte del trabajo.
