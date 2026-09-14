# night-runner

Ejecuta de noche, sin supervisión, tareas ya especificadas en
[`prompts/planned/`](../../prompts/planned), y deja **una rama y un Pull
Request por tarea** para que una persona los revise a la mañana.

No es parte del producto. Es herramienta de operación: podés borrar este
directorio y el ERP sigue funcionando igual.

## Lo que hace y lo que no hace

Por cada iteración:

1. Vuelve a `main` limpio y actualizado.
2. Toma la próxima tarea sin reclamar de `prompts/planned/`.
3. Crea `agent/claude-<slug>` desde `main` y le pasa la tarea a `claude -p`.
4. Corre la verificación del repositorio (las mismas órdenes que CI).
5. Si pasa: commit + push + Pull Request. Si no: deja la rama pusheada,
   **sin** PR, y sigue con la próxima.

**Nunca** mergea, **nunca** escribe en `main`, **nunca** borra ramas del
remoto. La integración la hacés vos, despierto. Esto no es negociable por
configuración: hay una comprobación explícita antes de cada push.

## Requisitos

- `claude` (Claude Code CLI), autenticado.
- `jq`, `git`. Opcional: `gh` para que abra los PRs solo; sin `gh` la rama
  queda pusheada y el log imprime el enlace para abrirlo a mano.
- El proyecto instalado y en condiciones de correr `npm run build` local.

## Primera corrida

Probá siempre en seco antes de dejarlo solo. El modo `--dry-run` recorre la
selección de tareas y escribe el prompt exacto que le pasaría a Claude, pero
no lo invoca ni pushea nada:

```bash
tools/night-runner/night-runner.sh --dry-run
```

Leé el prompt generado en `~/.erp-night-runner/runs/<id>/<tarea>/prompt.txt`.
Si dice lo que querés, corré una tarea de verdad:

```bash
MAX_TASKS=1 tools/night-runner/night-runner.sh
```

Recién cuando esa tarea salga como esperabas, dejalo con `MAX_TASKS` más alto.

## Cómo se le cargan las tareas

El runner **no inventa trabajo**. Consume archivos de `prompts/planned/`, en
el formato que ya define [`prompts/README.md`](../../prompts/README.md).

Ese es el lugar donde entra ChatGPT en este esquema: antes de dormir, le pedís
las especificaciones de la noche, **las leés**, y las guardás como archivos en
`prompts/planned/`. El runner las ejecuta en orden alfabético.

La ventaja de que la tarea sea un archivo versionado y no un mensaje de chat es
que a la mañana podés leer el PR **al lado de la especificación que lo originó**
y juzgar si el agente hizo lo que se le pidió.

## El planificador automático (apagado por defecto)

Con `ENABLE_PLANNER=1`, cuando se agotan las tareas escritas por una persona,
el runner le pide a la API de OpenAI que redacte una especificación nueva y se
la da a Claude para que la ejecute esa misma noche.

Pensalo antes de encenderlo. Significa que **un modelo escribe instrucciones
que otro modelo ejecuta sobre tu repositorio, sin que nadie las haya leído.**
Las barreras siguen valiendo — no mergea, no toca `main`, la verificación tiene
que dar verde, vos revisás el PR — pero el *contenido* del trabajo deja de
estar decidido por una persona, y el revisor de la mañana pierde la referencia
más útil que tiene: una especificación que él mismo aprobó.

Los archivos que genera quedan marcados como autogenerados y sin revisar.

```bash
ENABLE_PLANNER=1 OPENAI_API_KEY=sk-... tools/night-runner/night-runner.sh
```

La alternativa sana es dejarlo en `0` y cargar las tareas a mano.

## Frenarlo

Desde cualquier terminal:

```bash
touch ~/.erp-night-runner/STOP
```

El runner lo mira antes de arrancar cada tarea. La que está en curso se
termina; no arranca otra. Para cortar en el acto, `Ctrl-C` o matá el proceso:
el trabajo hecho hasta ahí queda commiteado en la rama.

## Configuración

Todo por variables de entorno.

| Variable | Default | Para qué |
| --- | --- | --- |
| `MAX_TASKS` | `3` | Tope de tareas por corrida. La cota más importante. |
| `DEADLINE` | `07:00` | A partir de esta hora no arranca tareas nuevas. |
| `TASK_TIMEOUT` | `2700` | Corte duro por tarea, en segundos. |
| `MAX_CONSECUTIVE_FAILURES` | `2` | Fallos seguidos antes de detenerse. |
| `VERIFY_CMD` | lint + typecheck + tests + build | Qué tiene que dar verde. |
| `CLAUDE_MODEL` | `opus` | Modelo de Claude Code. |
| `MAX_BUDGET_USD` | — | Tope de gasto por tarea. Sólo aplica con API key. |
| `PERMISSION_MODE` | `acceptEdits` | Ver abajo. |
| `ALLOWED_TOOLS` | lista angosta | Ver abajo. |
| `ENABLE_PLANNER` | `0` | Planificador de OpenAI. Ver arriba. |
| `RUN_REVIEW` | `0` | Corre `claude ultrareview` sobre cada rama verde. |
| `REPO_DIR` | raíz del repo | Por si lo corrés desde otro lado. |
| `STATE_DIR` | `~/.erp-night-runner` | Logs y estado. Fuera del repositorio. |

### Permisos

`acceptEdits` + `--permission-prompts none` significa: edita archivos sin
preguntar, ejecuta sólo las órdenes de la lista blanca, y **cualquier otra cosa
se deniega sola** en vez de quedarse colgada esperando a alguien que está
durmiendo.

La lista blanca es angosta a propósito: leer, editar, y las órdenes que el
proyecto necesita para construir y verificar. Sin `rm`, sin `git push`, sin
`git checkout`, sin red. El push lo hace el runner después de verificar, no el
agente.

No lo pongas en `bypassPermissions`. Le da vía libre a todo, sin nadie mirando.

### La verificación

Por defecto replica [`ci.yml`](../../.github/workflows/ci.yml) salvo los pasos
que necesitan Postgres y Redis:

```
npm run lint && npm run typecheck && npm test && npm run test:gestion && npm run test:facturacion && npm run build
```

Si dejás `docker compose up -d` levantado toda la noche, vale la pena sumar los
e2e, que son los que más errores reales encuentran en este proyecto:

```bash
VERIFY_CMD="npm run lint && npm run typecheck && npm test && npm run test:gestion && npm run test:facturacion && npm run test:e2e && npm run build" \
  tools/night-runner/night-runner.sh
```

## A la mañana

```bash
cat ~/.erp-night-runner/runs/<id>/runner.log
```

Por cada tarea hay un directorio con `prompt.txt` (lo que se le pidió),
`summary.txt` (lo que dice que hizo), `verify.log` (la salida completa de la
verificación) y, si lo activaste, `review.txt`.

Un resumen que empieza con `BLOQUEADO:` es el agente diciendo que no llegó. Esa
rama se pushea igual, sin PR: el trabajo parcial está ahí para que lo mires,
no para que lo mergees.

**Que un PR esté verde no quiere decir que esté bien.** Verde quiere decir que
compila y que los tests que existían siguen pasando. Los errores que este
proyecto necesita que no se escapen — fuga entre empresas, permisos que faltan,
plata en punto flotante, escrituras de stock fuera del ledger — pasan CI sin
despeinarse. La lista de prioridades de revisión está en
[AGENTS.md](../../AGENTS.md), sección *Code Review Rules*.

Cuatro PRs revisados con sueño a las 7 de la mañana son peores que dos
revisados bien. `MAX_TASKS` está en 3 por eso.

## Después de mergear

Seguí el protocolo de `prompts/README.md`: mover el archivo de `planned/` a
`completed/`, `Status: DONE`, número de PR. El runner no lo hace porque no
mergea.

El estado de "tarea ya reclamada" vive en `~/.erp-night-runner/claimed.txt`,
fuera del repositorio, porque las ramas de la noche no están mergeadas: si el
runner mirara el `Status:` del archivo en `main`, tomaría la misma tarea todas
las noches. Si querés que vuelva a intentar una tarea, borrá su línea de ese
archivo.
