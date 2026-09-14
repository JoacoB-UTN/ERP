# Manual del night-runner

## Qué es

Un script que corre en tu Mac mientras dormís. Vos le dejás escritas las
tareas de la noche; él las va haciendo de a una, y por cada una te deja una
rama y un Pull Request en GitHub para que lo revises a la mañana.

No mergea nada. No toca `main`. Eso lo hacés vos, despierto.

No es parte del ERP. Es una herramienta de trabajo: si borrás este directorio,
el sistema sigue funcionando igual.

## Cómo es una noche, concretamente

Son las 23:30. Le dejás escritas dos tareas. Te vas a dormir.

```
23:31  Tarea 1: "agregar filtro por fecha al listado de ventas"
       → crea la rama agent/claude-016-filtro-fecha-ventas
       → Claude trabaja 25 minutos
       → corre lint, typecheck, tests y build → todo verde
       → pushea y abre el PR #33

00:04  Tarea 2: "mostrar el total del día en el POS"
       → crea la rama agent/claude-017-total-dia-pos
       → Claude trabaja 18 minutos
       → corre la verificación → los tests fallan
       → pushea la rama, NO abre PR, anota el error y sigue

00:25  No quedan tareas. Termina.
```

A las 8 de la mañana abrís GitHub: hay **un** PR para revisar (el #33) y una
rama con problemas que mirás si tenés ganas. Lo que estaba roto no llegó a
proponerse como listo.

## Preparación (una sola vez)

**1. Instalá dos programas** que el script necesita:

```bash
brew install jq gh
```

`jq` lee respuestas en JSON. `gh` es el de GitHub, para que abra los PRs solo.
Después de instalar `gh`, conectalo a tu cuenta una vez:

```bash
gh auth login
```

**2. Probalo en seco.** Esto no ejecuta nada: sólo te muestra qué tarea
agarraría y qué le diría a Claude.

```bash
cd ~/ruta/a/ERP
tools/night-runner/night-runner.sh --dry-run
```

Te va a imprimir dónde guardó el archivo `prompt.txt`. Abrilo y leelo. Eso es
literalmente lo que Claude va a recibir.

**3. Probá una tarea de verdad, despierto.** Antes de confiarle una noche
entera, mirá cómo le sale una sola:

```bash
MAX_TASKS=1 tools/night-runner/night-runner.sh
```

Quedate mirando. Cuando esa tarea salga como esperabas, ya podés dejarlo solo.

## La rutina de cada noche

### Paso 1 — Conseguir las tareas

El runner **no inventa trabajo**. Ejecuta tareas escritas en archivos, dentro
de la carpeta `prompts/planned/`.

Acá es donde entra ChatGPT. Copiale este mensaje, cambiando la última línea por
lo que querés que se haga:

> Necesito la especificación de una tarea para un ERP multiempresa (NestJS +
> Prisma + PostgreSQL, y dos frontends Next.js: "Gestión" para administración y
> "Facturación" para el mostrador).
>
> Devolvemela en Markdown, con esta estructura exacta y nada más:
>
> ```
> # Task NNN — <título en castellano>
>
> Status: PLANNED
> Depends on: —
> Agent: UNASSIGNED
> Base branch: main
> Branch:
> PR:
>
> ## Objective
>
> <qué hay que lograr, en prosa>
>
> ## Acceptance criteria
>
> <lista de condiciones verificables>
>
> ## Out of scope
>
> <lista de lo que explícitamente NO hay que tocar>
> ```
>
> Reglas:
> - Tiene que poder ejecutarla cualquier agente o una persona, sin contexto de
>   esta conversación. Nunca empieces con "Claude, ..." ni "Codex, ...".
> - Antes de tocar nada hay que leer AGENTS.md y los docs del módulo.
> - El alcance tiene que entrar en un solo Pull Request revisable.
> - Incluí en las condiciones que hay que actualizar la documentación del
>   módulo en el mismo cambio.
>
> La tarea es: **<acá escribís qué querés>**

**Leé lo que te devuelve.** Este es el único momento de la noche en que una
persona controla qué se va a hacer; si la especificación está mal, a la mañana
tenés un PR que hace lo que no querías.

### Paso 2 — Guardar el archivo

Los archivos se numeran en orden. Mirá cuál es el último:

```bash
ls prompts/planned/ prompts/completed/
```

Si el más alto es `015-`, el tuyo va a ser `016-`. El nombre es el número, un
guion, y un título corto en minúsculas con guiones:

```bash
# pegá el texto de ChatGPT acá adentro y guardá con Ctrl-O, Ctrl-X
nano prompts/planned/016-filtro-fecha-ventas.md
```

Si dejás varias tareas, se ejecutan en orden alfabético: `016`, `017`, `018`.

### Paso 3 — Commitear y pushear

**Este paso no es opcional.** El runner vuelve a `main` limpio entre tarea y
tarea, así que si los archivos están sólo en tu máquina, desaparecen. El script
se niega a arrancar si detecta esto, pero mejor hacerlo bien:

```bash
git checkout main
git pull origin main
git add prompts/planned/
git commit -m "prompts: tareas de la noche"
git push origin main
```

### Paso 4 — Arrancarlo

```bash
tools/night-runner/night-runner.sh
```

Dejá la terminal abierta. Si usás la Mac para otra cosa, abrí otra pestaña.

Si querés que sobreviva a que se cierre la terminal:

```bash
nohup tools/night-runner/night-runner.sh > /dev/null 2>&1 &
```

### Paso 5 — Dormir

Por defecto hace **3 tareas como máximo** y no arranca ninguna nueva después
de las **7:00**.

## A la mañana

**Primero, el resumen de la noche:**

```bash
cat ~/.erp-night-runner/runs/*/runner.log
```

Ahí ves, tarea por tarea, si terminó en verde, si falló la verificación, o si
Claude se declaró bloqueado.

**Después, los PRs en GitHub.** Sólo hay PR para lo que pasó la verificación
completa. Cada uno dice en el cuerpo que nadie lo revisó todavía.

**Si algo falló y querés saber por qué,** cada tarea deja su carpeta:

```bash
ls ~/.erp-night-runner/runs/<fecha-hora>/<nombre-de-la-tarea>/
```

| Archivo | Qué contiene |
| --- | --- |
| `prompt.txt` | lo que se le pidió |
| `summary.txt` | lo que dice que hizo |
| `verify.log` | la salida completa de lint, tests y build |
| `claude.err` | errores del propio Claude, si hubo |

Un `summary.txt` que empieza con `BLOQUEADO:` es Claude diciendo que no llegó.
Esa rama se pushea igual pero sin PR: el trabajo parcial está ahí para que lo
mires, no para que lo mergees.

### Lo más importante de todo

**Que un PR esté verde no quiere decir que esté bien.** Verde quiere decir dos
cosas nada más: que compila, y que los tests que ya existían siguen pasando.

Los errores que este proyecto no se puede permitir pasan la verificación sin
despeinarse:

- datos de una empresa apareciendo en otra,
- un endpoint sin `@RequirePermissions`,
- plata calculada en punto flotante en vez de `Decimal`,
- stock escrito fuera del ledger.

Esos cuatro son los que tenés que buscar a mano en el diff. La lista completa,
en orden de prioridad, está en [AGENTS.md](../../AGENTS.md), sección
*Code Review Rules*.

Y una cuenta simple: cuatro PRs revisados con sueño a las 7 de la mañana son
peores que dos revisados bien. Por eso el tope viene en 3.

### Después de mergear

Seguí el protocolo de [`prompts/README.md`](../../prompts/README.md): mover el
archivo de `planned/` a `completed/`, poner `Status: DONE` y el número de PR.
El runner no lo hace porque no mergea.

## Frenarlo

Desde cualquier otra terminal:

```bash
touch ~/.erp-night-runner/STOP
```

Lo mira antes de arrancar cada tarea. La que está en curso la termina; no
arranca otra.

Para cortar en el acto: `Ctrl-C`. El trabajo hecho hasta ahí queda commiteado
en la rama, no se pierde.

## Si algo sale mal

| Lo que te dice | Qué significa y qué hacer |
| --- | --- |
| `El árbol de trabajo no está limpio` | Tenés cambios sin commitear. El runner borra archivos sueltos entre tareas, así que se niega a arrancar. Commiteá o borrá lo que aparece en la lista. |
| `Tu main local tiene N commit(s) que no están en origin/main` | Te olvidaste del `git push origin main` del paso 3. |
| `No hay tareas sin reclamar en prompts/planned/` | No dejaste tareas, o ya las hizo todas en una corrida anterior. |
| `Falta 'jq'` / `Falta el CLI 'claude'` | No hiciste la preparación. Volvé al paso 1. |
| `La verificación falló` | Claude hizo algo que rompe el build o los tests. La rama está pusheada sin PR; mirá `verify.log`. |
| `Claude superó el tiempo límite` | La tarea era muy grande para 45 minutos. Partila en dos, o subí `TASK_TIMEOUT`. |
| `2 fallos seguidos. El runner se detiene.` | Casi siempre es el entorno, no las tareas. Corré la verificación a mano y mirá qué pasa. |

### Repetir una tarea

El runner anota qué tareas ya agarró, para no repetirlas todas las noches. Si
querés que vuelva a intentar una, borrá su línea de acá:

```bash
nano ~/.erp-night-runner/claimed.txt
```

(Está fuera del repositorio a propósito: las ramas de la noche no están
mergeadas, así que el `Status:` del archivo en `main` sigue diciendo `PLANNED`
y el runner agarraría la misma tarea para siempre.)

## Perillas

Se cambian poniéndolas adelante del comando:

```bash
MAX_TASKS=5 DEADLINE=06:00 tools/night-runner/night-runner.sh
```

| Variable | Viene en | Para qué |
| --- | --- | --- |
| `MAX_TASKS` | `3` | Tope de tareas por noche. La perilla más importante. |
| `DEADLINE` | `07:00` | Hora a partir de la cual no arranca tareas nuevas. |
| `TASK_TIMEOUT` | `2700` | Corte por tarea, en segundos (45 min). |
| `MAX_CONSECUTIVE_FAILURES` | `2` | Fallos seguidos antes de rendirse. |
| `VERIFY_CMD` | ver abajo | Qué tiene que dar verde para que abra PR. |
| `CLAUDE_MODEL` | `opus` | Modelo de Claude Code. |
| `MAX_BUDGET_USD` | — | Tope de gasto por tarea. Sólo aplica con API key, no con suscripción. |
| `RUN_REVIEW` | `0` | En `1`, además le pide a Claude una revisión de cada rama verde. |
| `ENABLE_PLANNER` | `0` | Ver la sección de abajo. |
| `STATE_DIR` | `~/.erp-night-runner` | Dónde deja los logs. |

### La verificación

Por defecto corre lo mismo que CI, menos los pasos que necesitan base de datos:

```
npm run lint && npm run typecheck && npm test && npm run test:gestion && npm run test:facturacion && npm run build
```

Si dejás la base levantada toda la noche (`docker compose up -d`), vale mucho
la pena sumar los tests e2e: son los que encuentran los errores reales en este
proyecto.

```bash
VERIFY_CMD="npm run lint && npm run typecheck && npm test && npm run test:gestion && npm run test:facturacion && npm run test:e2e && npm run build" \
  tools/night-runner/night-runner.sh
```

## El planificador automático (viene apagado)

Con `ENABLE_PLANNER=1` y una `OPENAI_API_KEY`, cuando se le terminan las tareas
que escribiste vos, el runner le pide a la API de OpenAI que invente una nueva y
se la da a Claude para que la haga esa misma noche.

Pensalo antes de encenderlo. Significa que **un modelo escribe las
instrucciones que otro modelo ejecuta sobre tu repositorio, sin que nadie las
lea.** Las barreras siguen valiendo (no mergea, no toca `main`, la verificación
tiene que dar verde, vos revisás el PR), pero el *qué se hace* deja de decidirlo
una persona — y a la mañana perdés la referencia más útil que tenías para
juzgar el PR: una especificación que vos mismo aprobaste.

Los archivos que genera quedan marcados como autogenerados y sin revisar.

```bash
ENABLE_PLANNER=1 OPENAI_API_KEY=sk-... tools/night-runner/night-runner.sh
```

Sirve para explorar. Para trabajo que vas a mergear, dejalo en `0`.

## Lo que nunca hace

Esto no se puede cambiar por configuración. Hay una comprobación en el código
antes de cada push:

- Nunca mergea un Pull Request.
- Nunca escribe en `main` ni pushea a `main`.
- Nunca borra ramas del remoto.
- Nunca abre PR de una rama que no pasó la verificación.

Y a Claude lo corre con una lista blanca angosta: puede leer, editar, y correr
las órdenes de `npm` que el proyecto necesita. Sin `rm`, sin `git push`, sin
`git checkout`, sin red. El push lo hace el runner, después de verificar.
