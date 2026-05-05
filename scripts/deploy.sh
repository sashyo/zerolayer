#!/usr/bin/env bash
# ─── ZeroLayer · deploy to Vercel + hosted Supabase ──────────────────────────
#
#   ./scripts/deploy.sh                # full deploy (push schema + env + ship)
#   ./scripts/deploy.sh env             # only sync env vars to Vercel
#   ./scripts/deploy.sh schema          # only `prisma db push` against hosted DB
#   ./scripts/deploy.sh ship            # only `vercel --prod`
#
# Requirements (auto-checked):
#   • You're logged in to Vercel CLI:  npx vercel login
#   • You have a hosted Supabase project (free tier is fine).
#   • You have a hosted TideCloak realm OR are reusing the local one tunneled.
#
# This script NEVER reads or writes a committed secret. It prompts for hosted
# credentials interactively (or accepts them from your shell env) and pushes
# them straight to Vercel via the API. Nothing stays on disk.
#
# All of these are required at deploy time — set in your shell, in a
# *gitignored* `.env.deploy.local`, or paste when prompted:
#   DATABASE_URL_PROD             postgres://...pooler.supabase.com:6543/postgres
#   DIRECT_URL_PROD               postgres://...supabase.co:5432/postgres
#   NEXT_PUBLIC_SUPABASE_URL      https://<ref>.supabase.co
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
#   NEXT_PUBLIC_TIDECLOAK_URL     https://<your-tidecloak>
#   NEXT_PUBLIC_TIDECLOAK_REALM
#   NEXT_PUBLIC_TIDECLOAK_CLIENT_ID
#   NEXT_PUBLIC_APP_URL           https://<vercel-domain>
#
# Optional (the script picks sensible defaults if absent):
#   VERCEL_REGION                 e.g. syd1, iad1 (matches your Supabase region)
#   VERCEL_PROJECT_NAME           defaults to repo dir name

set -euo pipefail

# ── colors ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OFF='\033[0m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_CYAN='\033[36m'
else
  C_OFF=''; C_BOLD=''; C_DIM=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''
fi

step() { printf "${C_CYAN}▸${C_OFF} %s\n" "$*"; }
ok()   { printf "${C_GREEN}✓${C_OFF} %s\n" "$*"; }
warn() { printf "${C_YELLOW}!${C_OFF} %s\n" "$*"; }
fail() { printf "${C_RED}✗ %s${C_OFF}\n" "$*" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

CMD="${1:-all}"
have() { command -v "$1" >/dev/null 2>&1; }

# ── prereqs ──────────────────────────────────────────────────────────────────
have node || fail "Node.js is required."
have npx  || fail "npx is required (ships with Node 16+)."

# We deliberately use `npx vercel` and `npx prisma` — no global installs needed.
# .env.deploy.local is gitignored (.env.* matches it). The user can stash hosted
# values there for repeat runs without committing them.
if [ -f .env.deploy.local ]; then
  step "Loading hosted overrides from .env.deploy.local (gitignored)"
  # shellcheck disable=SC1091
  set -a && . ./.env.deploy.local && set +a
fi

REQUIRED_KEYS=(
  DATABASE_URL_PROD
  DIRECT_URL_PROD
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  NEXT_PUBLIC_TIDECLOAK_URL
  NEXT_PUBLIC_TIDECLOAK_REALM
  NEXT_PUBLIC_TIDECLOAK_CLIENT_ID
  NEXT_PUBLIC_APP_URL
)

prompt_missing() {
  for key in "${REQUIRED_KEYS[@]}"; do
    if [ -z "${!key:-}" ]; then
      printf "${C_BOLD}%s${C_OFF}: " "$key"
      # Read silently for anything ending in _KEY or PASSWORD; otherwise echo.
      if [[ "$key" == *KEY* || "$key" == *PASSWORD* || "$key" == *SECRET* ]]; then
        IFS= read -rs val
        printf "\n"
      else
        IFS= read -r val
      fi
      [ -n "$val" ] || fail "Empty value for $key — aborting."
      export "$key=$val"
    fi
  done
}

# ── subcommands ──────────────────────────────────────────────────────────────
cmd_env() {
  step "Pushing env vars to Vercel (production scope)"
  prompt_missing

  # Use the Vercel CLI's `env add` interactively — it picks up the linked
  # project from `.vercel/project.json`. The CLI streams stdin reliably for
  # short single-line values.
  npx vercel link --yes >/dev/null
  push_env() {
    local key="$1"; local value="$2"
    # Remove existing value (fail OK if it doesn't exist) then add fresh.
    npx vercel env rm "$key" production --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | npx vercel env add "$key" production >/dev/null
    ok "set $key"
  }

  push_env DATABASE_URL                       "$DATABASE_URL_PROD"
  push_env DIRECT_URL                         "$DIRECT_URL_PROD"
  push_env NEXT_PUBLIC_SUPABASE_URL           "$NEXT_PUBLIC_SUPABASE_URL"
  push_env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  push_env NEXT_PUBLIC_TIDECLOAK_URL          "$NEXT_PUBLIC_TIDECLOAK_URL"
  push_env NEXT_PUBLIC_TIDECLOAK_REALM        "$NEXT_PUBLIC_TIDECLOAK_REALM"
  push_env NEXT_PUBLIC_TIDECLOAK_CLIENT_ID    "$NEXT_PUBLIC_TIDECLOAK_CLIENT_ID"
  push_env NEXT_PUBLIC_APP_URL                "$NEXT_PUBLIC_APP_URL"

  ok "Env synced. Verify with 'npx vercel env ls production'."
}

cmd_schema() {
  step "Running prisma db push against hosted DB"
  prompt_missing
  # Use a temp file so the secret never lives in shell history.
  local tmp
  tmp="$(mktemp -t zerolayer-deploy.XXXXXX)"
  trap 'shred -u "$tmp" 2>/dev/null || rm -f "$tmp"' EXIT
  cat >"$tmp" <<EOF
DATABASE_URL=$DATABASE_URL_PROD
DIRECT_URL=$DIRECT_URL_PROD
EOF
  # shellcheck disable=SC1090
  set -a && . "$tmp" && set +a
  npx prisma generate
  npx prisma db push
  ok "Schema in sync."
}

cmd_ship() {
  step "Deploying to Vercel (production)"
  if [ -n "${VERCEL_REGION:-}" ] && [ ! -f vercel.json ]; then
    cat >vercel.json <<EOF
{
  "\$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["$VERCEL_REGION"]
}
EOF
    ok "wrote vercel.json with region $VERCEL_REGION"
  fi
  npx vercel link --yes >/dev/null
  npx vercel --prod --yes
}

cmd_all() {
  cmd_env
  cmd_schema
  cmd_ship
  ok "Deployed."
}

case "$CMD" in
  all|deploy|"") cmd_all ;;
  env)           cmd_env ;;
  schema|db)     cmd_schema ;;
  ship)          cmd_ship ;;
  *) fail "Unknown command: $CMD. Try: all | env | schema | ship" ;;
esac
