#!/usr/bin/env bash
# ─── ZeroLayer · run locally ──────────────────────────────────────────────────
#
# Brings the entire stack up on a fresh checkout — no cloud accounts needed.
#
#   ./scripts/run-local.sh         # bootstrap (idempotent) + start dev server
#   ./scripts/run-local.sh stop    # stop the local Docker stack
#   ./scripts/run-local.sh reset   # tear down + wipe local data (destructive)
#   ./scripts/run-local.sh status  # show what's running
#
# Side effects (all local, all reversible via `reset`):
#   • Installs Node deps via `npm install`.
#   • Auto-installs `jq` via the platform package manager when missing.
#   • Brings up `postgres` + `tidecloak` containers (docker-compose.yml).
#   • Runs scripts/init.ts to bootstrap the TideCloak realm + Prisma schema.
#   • Writes `.env` with local-stack values (gitignored).
#   • Starts `next dev` on $PORT (default 3000).
#
# Never commits secrets. `.env`, `public/adapter.json`, and any marker files
# under `data/` are all in `.gitignore`.

set -euo pipefail

# ── colors ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OFF='\033[0m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_CYAN='\033[36m'
else
  C_OFF=''; C_BOLD=''; C_DIM=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''
fi

step()  { printf "${C_CYAN}▸${C_OFF} %s\n" "$*"; }
ok()    { printf "${C_GREEN}✓${C_OFF} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}!${C_OFF} %s\n" "$*"; }
fail()  { printf "${C_RED}✗ %s${C_OFF}\n" "$*" >&2; exit 1; }

# ── locate repo root ─────────────────────────────────────────────────────────
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

CMD="${1:-up}"

# ── helpers ──────────────────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

ensure_docker() {
  if ! have docker; then
    fail "Docker is required and could not be auto-installed. Install Docker Desktop (Mac/Windows) or 'sudo apt-get install docker.io' (Linux), then re-run."
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "Docker is installed but the daemon isn't reachable. Start Docker Desktop (or 'sudo systemctl start docker'), then re-run."
  fi
}

ensure_node() {
  have node || fail "Node.js is required. Install from https://nodejs.org or via nvm, then re-run."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 20 ]; then
    fail "Node 20+ required (found $(node -v)). Upgrade and re-run."
  fi
}

ensure_jq() {
  have jq && return 0
  step "jq missing — attempting auto-install…"
  case "$(uname -s)" in
    Darwin)
      have brew && brew install jq && return 0
      fail "jq missing and Homebrew not found. Install jq from https://jqlang.github.io/jq/download/ then re-run."
      ;;
    Linux)
      if have apt-get; then
        sudo apt-get update -qq && sudo apt-get install -y jq && return 0
      elif have dnf; then
        sudo dnf install -y jq && return 0
      elif have pacman; then
        sudo pacman -S --noconfirm jq && return 0
      fi
      fail "jq missing. Install via your package manager (apt-get install jq / dnf install jq / pacman -S jq) and re-run."
      ;;
    MINGW*|MSYS*|CYGWIN*)
      have winget && winget install --id jqlang.jq -e && return 0
      have choco  && choco install jq -y && return 0
      fail "jq missing on Windows. Install with 'winget install jqlang.jq' or 'choco install jq', then re-run."
      ;;
    *)
      fail "Unknown OS '$(uname -s)' — install jq manually and re-run."
      ;;
  esac
}

ensure_curl() {
  have curl || fail "curl is required. Install via your package manager and re-run."
}

# ── subcommands ──────────────────────────────────────────────────────────────
cmd_status() {
  step "Local stack status"
  docker compose ps 2>/dev/null || warn "docker-compose has not been started yet."
  if [ -f .env ]; then ok ".env present"; else warn ".env missing — run './scripts/run-local.sh' to create it."; fi
  if [ -f public/adapter.json ]; then ok "public/adapter.json present"; else warn "adapter.json missing — init has not finished."; fi
}

cmd_stop() {
  step "Stopping local containers"
  docker compose stop || true
  ok "Stopped. Data is preserved — run './scripts/run-local.sh' to start again."
}

cmd_reset() {
  warn "This will WIPE local Postgres + TideCloak data. Type 'reset' to confirm:"
  read -r confirm
  [ "$confirm" = "reset" ] || fail "Aborted."
  docker compose down -v || true
  rm -f .env public/adapter.json
  rm -rf data/
  ok "Local stack torn down and wiped. Run './scripts/run-local.sh' to bootstrap fresh."
}

cmd_up() {
  step "Checking prerequisites"
  ensure_node
  ensure_docker
  ensure_curl
  ensure_jq
  ok "All prerequisites present"

  step "Installing Node dependencies (npm install)"
  npm install --no-audit --no-fund

  step "Bootstrapping local stack (Postgres + TideCloak realm + Prisma schema)"
  # init.ts is idempotent — re-running just verifies state and exits early
  # if the bootstrap markers are present.
  npx tsx scripts/init.ts

  step "Starting Next.js dev server"
  ok "Visit http://localhost:${PORT:-3000} once the server logs 'Ready'."
  exec npm run dev
}

case "$CMD" in
  up|start|"")  cmd_up ;;
  stop)         cmd_stop ;;
  reset|wipe)   cmd_reset ;;
  status|ps)    cmd_status ;;
  *) fail "Unknown command: $CMD. Try: up | stop | reset | status" ;;
esac
