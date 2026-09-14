#!/usr/bin/env bash
#
# night-runner — ejecuta de noche, sin supervisión, tareas ya especificadas en
# prompts/planned/, y deja una rama y un Pull Request por tarea para que una
# persona los revise a la mañana.
#
# Por cada iteración:
#   1. Vuelve a `main` limpio y actualizado.
#   2. Toma la próxima tarea sin reclamar de `prompts/planned/`.
#   3. Crea `agent/claude-<slug>` y le pasa la tarea a `claude -p`.
#   4. Corre la verificación del repositorio (las mismas órdenes que CI).
#   5. Si pasa: commit + push + Pull Request. Si no: deja la rama sin PR.
#
# Nunca mergea, nunca escribe en `main`, nunca borra ramas del remoto.
# La integración la hacés vos, despierto.
#
# Uso:
#   tools/night-runner/night-runner.sh              # corrida real
#   tools/night-runner/night-runner.sh --dry-run    # no invoca a Claude ni pushea
#   MAX_TASKS=2 tools/night-runner/night-runner.sh
#
# Para frenarlo desde otra terminal:
#   touch ~/.erp-night-runner/STOP
#
# Ver tools/night-runner/README.md antes de la primera corrida.

set -Eeuo pipefail

# ---------------------------------------------------------------- configuración

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE_DIR="${STATE_DIR:-$HOME/.erp-night-runner}"

# Cuántas tareas como mucho en la noche. La cota más importante del script.
MAX_TASKS="${MAX_TASKS:-3}"

# Hora local a partir de la cual no se arrancan tareas nuevas (HH:MM).
# Una tarea ya empezada se termina; simplemente no se arranca otra.
DEADLINE="${DEADLINE:-07:00}"

# Corte duro por tarea, en segundos (45 min). Si Claude se cuelga, se mata.
TASK_TIMEOUT="${TASK_TIMEOUT:-2700}"

# Después de esta cantidad de fracasos seguidos el runner se detiene: si dos
# tareas seguidas fallaron, lo más probable es que el problema sea el entorno,
# y seguir sólo produce ramas rotas.
MAX_CONSECUTIVE_FAILURES="${MAX_CONSECUTIVE_FAILURES:-2}"

# Verificación. Réplica de .github/workflows/ci.yml sin los pasos que necesitan
# Postgres y Redis. Si dejás `docker compose up -d` levantado, agregá:
#   VERIFY_CMD="... && npm run test:e2e"
VERIFY_CMD="${VERIFY_CMD:-npm run lint && npm run typecheck && npm test && npm run test:gestion && npm run test:facturacion && npm run build}"

# Modelo de Claude Code.
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"

# Tope de gasto por tarea, en dólares. Sólo tiene efecto con autenticación por
# API key; con suscripción, Claude Code lo ignora.
MAX_BUDGET_USD="${MAX_BUDGET_USD:-}"

# --- Planificador automático (APAGADO por defecto, a propósito) ---------------
#
# En 1, cuando se agotan las tareas escritas por una persona, el runner le pide
# a la API de OpenAI que redacte una especificación nueva y se la da a Claude
# para que la ejecute esa misma noche.
#
# Pensalo antes de encenderlo: significa que un modelo escribe instrucciones que
# otro modelo ejecuta sobre tu repositorio, sin que nadie las haya leído. Las
# barreras de abajo siguen valiendo (no mergea, no toca main, CI tiene que dar
# verde, vos revisás el PR), pero el contenido del trabajo deja de estar
# decidido por una persona.
#
# La alternativa sana: escribí vos —o ChatGPT, y las leés— los archivos de
# prompts/planned/ antes de dormir, y dejá esto en 0.
ENABLE_PLANNER="${ENABLE_PLANNER:-0}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"

# Modo de permisos de Claude Code. `acceptEdits` + `--permission-prompts none`
# significa: edita archivos sin preguntar, ejecuta sólo las órdenes de la lista
# blanca, y cualquier otra cosa se deniega sola en vez de quedarse colgada
# esperando a alguien que no está.
#
# No uses `bypassPermissions` acá. Le da vía libre a todo, sin nadie mirando.
PERMISSION_MODE="${PERMISSION_MODE:-acceptEdits}"

# Lista blanca deliberadamente angosta: leer, editar, y las órdenes que el
# proyecto necesita para construir y verificar. Sin `rm`, sin `git push`, sin
# `git checkout`, sin red. El push lo hace el runner, no el agente.
ALLOWED_TOOLS="${ALLOWED_TOOLS:-Read Edit Write Glob Grep TodoWrite Task Bash(npm run *) Bash(npm test*) Bash(npx prisma *) Bash(npx tsc *) Bash(npx jest *) Bash(npx vitest *) Bash(node *) Bash(git add *) Bash(git commit *) Bash(git status*) Bash(git diff*) Bash(git log*) Bash(git show*) Bash(ls *) Bash(cat *) Bash(head *) Bash(tail *) Bash(sed -n *) Bash(grep *) Bash(rg *) Bash(find *) Bash(mkdir -p *)}"

# Si vale 1, corre `claude ultrareview` sobre cada rama verde y guarda las
# observaciones, para que a la mañana leas la revisión antes del diff.
RUN_REVIEW="${RUN_REVIEW:-0}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# ------------------------------------------------------------------ utilidades

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$STATE_DIR/runs/$RUN_ID"
CLAIMED_FILE="$STATE_DIR/claimed.txt"
STOP_FILE="$STATE_DIR/STOP"

# Va a stderr, nunca a stdout: varias funciones devuelven su resultado por
# stdout y se capturan con $(...). Si log escribiera ahí, un mensaje suelto
# terminaría dentro de un nombre de archivo o de rama.
log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG_DIR/runner.log" >&2; }
die() { log "ERROR: $*"; exit 1; }

trap 'log "ERROR inesperado en la línea ${BASH_LINENO[0]}."' ERR

# `sed -i` no es portable entre macOS y GNU.
sed_inplace() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}

# Nunca, bajo ninguna circunstancia, operar sobre main.
assert_not_main() {
  local branch
  branch="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
  [[ "$branch" != "main" && "$branch" != "HEAD" ]] \
    || die "Se intentó pushear desde '$branch'. Abortado."
}

past_deadline() {
  local now_min deadline_min
  now_min=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))
  deadline_min=$(( 10#${DEADLINE%%:*} * 60 + 10#${DEADLINE##*:} ))
  # El deadline es de madrugada: sólo cuenta si ya pasó y todavía es de mañana.
  (( now_min >= deadline_min && now_min < deadline_min + 720 ))
}

# ------------------------------------------------------------------- preflight

preflight() {
  mkdir -p "$LOG_DIR"
  touch "$CLAIMED_FILE"

  [[ -d "$REPO_DIR/.git" ]] || die "$REPO_DIR no es un repositorio git."
  command -v claude >/dev/null || die "Falta el CLI 'claude' en el PATH."
  command -v jq     >/dev/null || die "Falta 'jq' (brew install jq)."
  command -v git    >/dev/null || die "Falta 'git'."

  # Entre tarea y tarea el runner hace `git clean -fd` para volver a un main
  # limpio. Eso borra archivos sin trackear. Así que exigimos un árbol
  # completamente limpio ANTES de empezar: es preferible negarse a arrancar que
  # borrarte a las 3 de la mañana un archivo que no habías commiteado.
  if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
    log "El árbol de trabajo no está limpio:"
    git -C "$REPO_DIR" status --short | head -20 | sed 's/^/   /'
    die "Commiteá, guardá o borrá eso antes de dormir. El runner no arranca así."
  fi

  local pending
  pending=$(count_available_tasks)
  if (( pending == 0 )) && [[ "$ENABLE_PLANNER" != "1" ]]; then
    die "No hay tareas sin reclamar en prompts/planned/ y el planificador está apagado. No hay nada que hacer."
  fi

  if [[ "$ENABLE_PLANNER" == "1" ]]; then
    command -v curl >/dev/null || die "El planificador necesita 'curl'."
    [[ -n "${OPENAI_API_KEY:-}" ]] || die "ENABLE_PLANNER=1 pero falta OPENAI_API_KEY."
    log "AVISO: el planificador está ENCENDIDO. Claude va a ejecutar"
    log "       especificaciones que ningún humano leyó. Leé el README."
  fi

  rm -f "$STOP_FILE"
  log "night-runner $RUN_ID"
  log "repo=$REPO_DIR  max_tareas=$MAX_TASKS  deadline=$DEADLINE  dry_run=$DRY_RUN"
  log "tareas escritas por humanos disponibles: $pending"
  log "logs=$LOG_DIR"
}

reset_to_main() {
  git -C "$REPO_DIR" checkout -q main
  git -C "$REPO_DIR" reset -q --hard
  git -C "$REPO_DIR" clean -qfd
  git -C "$REPO_DIR" fetch -q origin main
  git -C "$REPO_DIR" reset -q --hard origin/main
}

# ------------------------------------------------------- selección de la tarea

task_is_available() {
  local f="$1"
  grep -qxF "$(basename "$f")" "$CLAIMED_FILE" && return 1
  grep -qiE '^Status:[[:space:]]*(DONE|IN PROGRESS)' "$f" && return 1
  return 0
}

count_available_tasks() {
  local f n=0
  for f in "$REPO_DIR"/prompts/planned/*.md; do
    [[ -e "$f" ]] || continue
    task_is_available "$f" && n=$(( n + 1 ))
  done
  echo "$n"
}

# Ruta del próximo archivo sin reclamar de prompts/planned/. Vacío si no queda.
#
# El estado de "reclamada" vive en $CLAIMED_FILE, fuera del repositorio, porque
# las ramas de la noche no se mergean: si dependiéramos del `Status:` del
# archivo en main, el runner tomaría la misma tarea una y otra vez.
pick_planned_task() {
  local f
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    task_is_available "$f" && { echo "$f"; return 0; }
  done < <(ls "$REPO_DIR"/prompts/planned/*.md 2>/dev/null | sort)
  return 0
}

next_prompt_number() {
  local max
  max=$( { ls "$REPO_DIR/prompts/planned/" "$REPO_DIR/prompts/completed/" 2>/dev/null || true; } \
    | grep -oE '^[0-9]{3}-' | tr -d '-' | sort -n | tail -1 )
  printf '%03d' $(( 10#${max:-0} + 1 ))
}

# Le pide a OpenAI la especificación de la próxima tarea, en el formato que ya
# usa prompts/README.md. Escribe el archivo y devuelve su ruta por stdout.
# Sólo se llama con ENABLE_PLANNER=1.
plan_new_task() {
  local num payload response content slug body title outfile
  num="$(next_prompt_number)"

  local system_prompt
  system_prompt=$(cat <<'PROMPT'
Sos el planificador de un ERP multiempresa (NestJS + Prisma + PostgreSQL, y dos
frontends Next.js: "Gestión" y "Facturación"). Tu trabajo NO es escribir código:
es redactar la especificación de UNA sola unidad de trabajo, que después va a
ejecutar un agente de codificación sin ningún contexto previo de conversación.

Reglas del repositorio que tenés que respetar:
- La especificación va en Markdown plano, con las secciones: Objective,
  Acceptance criteria, Out of scope.
- Tiene que ser AGENT-NEUTRAL: nunca empieces con "Claude, ..." ni "Codex, ...".
  La tiene que poder ejecutar cualquier agente o una persona.
- El alcance tiene que entrar en un solo Pull Request revisable: una unidad de
  trabajo coherente, no un módulo entero ni tres cosas sueltas.
- No propongas tareas que dependan de trabajo que todavía no está mergeado.
- No propongas refactors amplios, renombres masivos, cambios de infraestructura
  ni migraciones destructivas.
- Preferí terminar o endurecer lo que ya existe antes que abrir un módulo nuevo.
- Nadie va a leer esta especificación antes de que se ejecute. Ante la duda,
  elegí el alcance más chico y reversible.
- Si el estado del repositorio no justifica ninguna tarea segura y acotada,
  devolvé done=true. Es una respuesta válida y preferible a inventar trabajo.

Respondé SOLAMENTE con un objeto JSON:
{
  "done": false,
  "slug": "kebab-case-corto",
  "title": "Título en castellano",
  "body": "<el Markdown completo de la especificación, sin la línea de título>"
}
PROMPT
)

  local context
  context=$(
    echo "## git log reciente"
    git -C "$REPO_DIR" log --oneline -15
    echo
    echo "## prompts/completed/"
    ls "$REPO_DIR/prompts/completed/" 2>/dev/null
    echo
    echo "## prompts/planned/"
    ls "$REPO_DIR/prompts/planned/" 2>/dev/null
    echo
    echo "## Tareas ya reclamadas por el runner (no las repitas)"
    cat "$CLAIMED_FILE"
    echo
    echo "## docs/roadmap.md"
    head -c 6000 "$REPO_DIR/docs/roadmap.md" 2>/dev/null
    echo
    echo "## docs/implementation-status.md"
    head -c 8000 "$REPO_DIR/docs/implementation-status.md" 2>/dev/null
  )

  payload=$(jq -n \
    --arg model "$OPENAI_MODEL" \
    --arg sys "$system_prompt" \
    --arg usr "$context" \
    '{model:$model,
      response_format:{type:"json_object"},
      messages:[{role:"system",content:$sys},{role:"user",content:$usr}]}')

  response=$(curl -sS --max-time 120 "$OPENAI_BASE_URL/chat/completions" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload") || { log "El planificador no pudo contactar a OpenAI."; return 1; }

  if ! content=$(jq -er '.choices[0].message.content' <<<"$response" 2>/dev/null); then
    log "Respuesta inesperada del planificador: $(head -c 400 <<<"$response")"
    return 1
  fi

  if [[ "$(jq -r '.done // false' <<<"$content")" == "true" ]]; then
    log "El planificador dice que no queda trabajo seguro por hacer."
    return 2
  fi

  slug=$(jq -r '.slug // empty' <<<"$content")
  body=$(jq -r '.body // empty' <<<"$content")
  title=$(jq -r '.title // empty' <<<"$content")
  [[ -n "$slug" && -n "$body" && -n "$title" ]] \
    || { log "El planificador devolvió una especificación incompleta."; return 1; }

  # El slug entra en un nombre de archivo y en un nombre de rama: no le creemos.
  slug=$(tr '[:upper:]' '[:lower:]' <<<"$slug" | tr -cd 'a-z0-9-' | cut -c1-48)
  [[ -n "$slug" ]] || { log "El planificador devolvió un slug inutilizable."; return 1; }

  outfile="$REPO_DIR/prompts/planned/${num}-${slug}.md"
  {
    echo "# Task ${num} — ${title}"
    echo
    echo "Status: PLANNED"
    echo "Depends on: —"
    echo "Agent: UNASSIGNED"
    echo "Base branch: main"
    echo "Branch:"
    echo "PR:"
    echo
    echo "> Especificación redactada automáticamente por el planificador del"
    echo "> night-runner en la corrida ${RUN_ID}. Ninguna persona la revisó"
    echo "> antes de ejecutarla."
    echo
    echo "$body"
  } > "$outfile"

  echo "$outfile"
}

# ------------------------------------------------------ ejecución de una tarea

run_task() {
  local task_file="$1" task_name branch task_log slug
  task_name="$(basename "$task_file")"
  slug="${task_name%.md}"
  branch="agent/claude-${slug}"
  task_log="$LOG_DIR/${slug}"
  mkdir -p "$task_log"

  log "── Tarea: $task_name"
  log "   rama: $branch"

  # Reclamada apenas empieza: si el runner muere, no la repite a ciegas.
  echo "$task_name" >> "$CLAIMED_FILE"

  git -C "$REPO_DIR" checkout -q -B "$branch" origin/main
  assert_not_main

  # Si la escribió el planificador, el archivo no está en git todavía: queda en
  # la rama para que la especificación viaje junto con el código que produjo.
  [[ -f "$task_file" ]] || die "Desapareció $task_file."

  # Reclamar la tarea dentro del archivo, según prompts/README.md.
  sed_inplace -e "s|^Status:.*|Status: IN PROGRESS|" \
              -e "s|^Agent:.*|Agent: Claude (night-runner)|" \
              -e "s|^Branch:.*|Branch: ${branch}|" "$task_file"

  local rel_task="${task_file#"$REPO_DIR"/}"
  local wrapper
  wrapper=$(cat <<PROMPT
Trabajás en este repositorio. Leé AGENTS.md antes de tocar nada.

Tu tarea está especificada en: ${rel_task}
Leela completa y ejecutala. Si contradice a AGENTS.md o al código, mandan
AGENTS.md y el código: la especificación describe una intención, no la verdad
del repositorio.

Reglas de esta corrida, no negociables:
- Ya estás en la rama ${branch}, creada desde main. No cambies de rama.
- Nunca hagas push, nunca mergees, nunca escribas en main. De eso se encarga el
  runner, y después una persona.
- Alcance: solamente lo que pide el archivo de tarea. Nada de refactors
  generales ni de arreglar cosas ajenas que veas de paso.
- Aislamiento estricto por companyId, permisos con @RequirePermissions,
  auditoría dentro de la misma transacción, realtime solamente después del
  commit. Decimal para plata y cantidades, nunca punto flotante.
- Si tocás el esquema Prisma, la migración tiene que ser aditiva y segura para
  una base con datos: sin DROP, sin ALTER destructivo, sin borrar filas.
- Actualizá docs/<módulo>.md y docs/implementation-status.md en el mismo cambio.
- Antes de dar nada por terminado, corré la verificación y que pase entera:
    ${VERIFY_CMD}
- Cuando esté verde, hacé commit (uno o varios, con mensajes claros).

Honestidad, que importa más que terminar:
- No afirmes que ejecutaste algo que no ejecutaste.
- No marques como implementado lo que no implementaste.
- No debilites, saltees ni borres un test para que pase la verificación.
- Si te trabás, dejá commiteado lo que hayas hecho y terminá tu respuesta con
  una línea que empiece con "BLOQUEADO:" explicando qué falta y por qué.
  Nadie te está mirando: una rama honestamente incompleta vale mucho más que
  una que dice estar terminada y no lo está.
PROMPT
)

  printf '%s\n' "$wrapper" > "$task_log/prompt.txt"

  if (( DRY_RUN )); then
    log "   [dry-run] no se invoca a Claude. Prompt en $task_log/prompt.txt"
    git -C "$REPO_DIR" checkout -q main
    return 0
  fi

  local claude_args=(
    -p "$wrapper"
    --model "$CLAUDE_MODEL"
    --permission-mode "$PERMISSION_MODE"
    --permission-prompts none
    --allowedTools $ALLOWED_TOOLS
    --output-format json
  )
  [[ -n "$MAX_BUDGET_USD" ]] && claude_args+=(--max-budget-usd "$MAX_BUDGET_USD")

  log "   Claude trabajando (corte a ${TASK_TIMEOUT}s)…"
  local claude_rc=0
  ( cd "$REPO_DIR" && timeout "$TASK_TIMEOUT" claude "${claude_args[@]}" ) \
    > "$task_log/claude.json" 2> "$task_log/claude.err" || claude_rc=$?

  if (( claude_rc == 124 )); then
    log "   ✗ Claude superó el tiempo límite."
  elif (( claude_rc != 0 )); then
    log "   ✗ Claude terminó con código $claude_rc — ver $task_log/claude.err"
  fi

  # El resumen final, para el informe de la mañana.
  jq -r '.result // empty' "$task_log/claude.json" 2>/dev/null \
    > "$task_log/summary.txt" || true

  if grep -qi '^BLOQUEADO:' "$task_log/summary.txt" 2>/dev/null; then
    log "   ✗ Claude se declaró bloqueado:"
    grep -i '^BLOQUEADO:' "$task_log/summary.txt" | head -3 | sed 's/^/      /' \
      | tee -a "$LOG_DIR/runner.log"
    finish_branch "$branch" "$task_log" "bloqueada"
    return 1
  fi

  # Red de contención: si quedó algo sin commitear, lo commitea el runner.
  if ! git -C "$REPO_DIR" diff --quiet || ! git -C "$REPO_DIR" diff --cached --quiet \
     || [[ -n "$(git -C "$REPO_DIR" ls-files --others --exclude-standard)" ]]; then
    log "   Quedaron cambios sin commitear; los commitea el runner."
    git -C "$REPO_DIR" add -A
    git -C "$REPO_DIR" commit -q -m "chore(night-runner): cambios sin commitear de ${slug}"
  fi

  if [[ -z "$(git -C "$REPO_DIR" rev-list origin/main.."$branch" 2>/dev/null)" ]]; then
    log "   ✗ No se produjo ningún commit. Rama descartada."
    git -C "$REPO_DIR" checkout -q main
    git -C "$REPO_DIR" branch -qD "$branch"
    return 1
  fi

  log "   Verificando…"
  local verify_rc=0
  ( cd "$REPO_DIR" && eval "$VERIFY_CMD" ) > "$task_log/verify.log" 2>&1 || verify_rc=$?

  if (( verify_rc != 0 )); then
    log "   ✗ La verificación falló (código $verify_rc). Sin PR."
    tail -25 "$task_log/verify.log" | sed 's/^/      /' >> "$LOG_DIR/runner.log"
    finish_branch "$branch" "$task_log" "verificación en rojo"
    return 1
  fi

  log "   ✓ Verificación en verde."

  if (( RUN_REVIEW )); then
    log "   Revisión automática de la rama…"
    ( cd "$REPO_DIR" && timeout 900 claude ultrareview ) \
      > "$task_log/review.txt" 2>&1 || log "   (la revisión no pudo completarse)"
  fi

  finish_branch "$branch" "$task_log" "verde"
  return 0
}

# Pushea la rama y, si está verde y hay `gh`, abre el Pull Request. Jamás mergea.
finish_branch() {
  local branch="$1" task_log="$2" state="$3"
  assert_not_main

  local push_ok=0 attempt delay=2
  for attempt in 1 2 3 4; do
    if git -C "$REPO_DIR" push -q -u origin "$branch" 2>>"$task_log/push.log"; then
      push_ok=1; break
    fi
    log "   push falló (intento $attempt); reintento en ${delay}s"
    sleep "$delay"; delay=$(( delay * 2 ))
  done
  if (( ! push_ok )); then
    log "   ✗ No se pudo pushear $branch."
    git -C "$REPO_DIR" checkout -q main
    return 1
  fi

  log "   Rama pusheada: $branch ($state)"

  if [[ "$state" == "verde" ]] && command -v gh >/dev/null; then
    local title body
    title="$(git -C "$REPO_DIR" log -1 --pretty=%s "$branch")"
    body=$(cat <<PRBODY
Generado sin supervisión por \`tools/night-runner\` en la corrida $RUN_ID.

**Verificación local:** en verde.

\`\`\`
$VERIFY_CMD
\`\`\`

**Resumen del agente:**

$(head -c 3000 "$task_log/summary.txt" 2>/dev/null)

---
Nadie miró este cambio todavía. Revisalo antes de mergear.
PRBODY
)
    if ( cd "$REPO_DIR" && gh pr create --base main --head "$branch" \
           --title "$title" --body "$body" ) >>"$task_log/pr.log" 2>&1; then
      log "   ✓ PR abierto."
    else
      log "   (no se pudo abrir el PR automáticamente; la rama está pusheada)"
    fi
  elif [[ "$state" == "verde" ]]; then
    log "   Abrí el PR a mano: https://github.com/JoacoB-UTN/ERP/compare/$branch?expand=1"
  fi

  git -C "$REPO_DIR" checkout -q main
}

# ------------------------------------------------------------------------ main

main() {
  preflight

  local completed=0 failures=0 consecutive=0

  while (( completed + failures < MAX_TASKS )); do
    if [[ -f "$STOP_FILE" ]]; then
      log "Encontrado el archivo STOP. Corte pedido."; break
    fi
    if past_deadline; then
      log "Se alcanzó el deadline ($DEADLINE). No se arrancan más tareas."; break
    fi
    if (( consecutive >= MAX_CONSECUTIVE_FAILURES )); then
      log "$consecutive fallos seguidos. El runner se detiene."; break
    fi

    reset_to_main

    local task_file plan_rc
    task_file="$(pick_planned_task)"

    if [[ -z "$task_file" ]]; then
      if [[ "$ENABLE_PLANNER" != "1" ]]; then
        log "No quedan tareas sin reclamar en prompts/planned/. Fin."; break
      fi
      log "No quedan tareas escritas. Consultando al planificador…"
      plan_rc=0
      task_file="$(plan_new_task)" || plan_rc=$?
      if (( plan_rc == 2 )); then break; fi
      if (( plan_rc != 0 )) || [[ -z "$task_file" ]]; then
        log "El planificador no entregó una tarea. Fin."; break
      fi
      log "Nueva especificación: $(basename "$task_file")"
    fi

    if run_task "$task_file"; then
      completed=$(( completed + 1 )); consecutive=0
    else
      failures=$(( failures + 1 )); consecutive=$(( consecutive + 1 ))
    fi
  done

  reset_to_main

  log "──────────────────────────────────────────"
  log "Fin. Tareas verdes: $completed. Con problemas: $failures."
  log "Ramas de la noche:"
  git -C "$REPO_DIR" branch -r --list 'origin/agent/claude-*' \
    --sort=-committerdate 2>/dev/null | head -10 | sed 's/^/   /' \
    | tee -a "$LOG_DIR/runner.log"
  log "Logs completos: $LOG_DIR"
  log "Nada fue mergeado. Revisá los PRs antes de integrar."
}

main "$@"
