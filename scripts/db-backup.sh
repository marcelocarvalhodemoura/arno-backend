#!/usr/bin/env bash
# Backup do Postgres com verificação de restauração.
#
#   scripts/db-backup.sh                 # usa DATABASE_URL do ambiente (ou do .env)
#   scripts/db-backup.sh --verify        # também restaura num banco temporário e compara as contagens
#
# O arquivo vai para ./backups/<banco>-<data>.dump (formato custom do pg_dump).
# Se o pg_dump local for mais antigo que o servidor, use PG_DOCKER_IMAGE=postgres:16-alpine para rodar
# as ferramentas num container (127.0.0.1/localhost viram host.docker.internal).
# Para restaurar de verdade: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" <arquivo>
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Defina DATABASE_URL." >&2
  exit 1
fi

# pg_dump não aceita parâmetros de query do Prisma (?schema=...).
URL="${DATABASE_URL%%\?*}"
DB_NAME="${URL##*/}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups
FILE="backups/${DB_NAME}-${STAMP}.dump"

pg_tool() {
  local tool="$1"
  shift
  if [[ -n "${PG_DOCKER_IMAGE:-}" ]]; then
    local args=()
    for arg in "$@"; do
      args+=("$(sed -E 's#@(127\.0\.0\.1|localhost)([:/])#@host.docker.internal\2#' <<<"$arg")")
    done
    docker run --rm -i -v "$PWD/backups:/backups" -w / "$PG_DOCKER_IMAGE" "$tool" "${args[@]}"
  else
    "$tool" "$@"
  fi
}

pg_tool pg_dump --format=custom --no-owner --no-privileges --file="${PG_DOCKER_IMAGE:+/}$FILE" "$URL"
echo "Backup gravado em $FILE ($(du -h "$FILE" | cut -f1))"

if [[ "${1:-}" != "--verify" ]]; then
  exit 0
fi

SCRATCH="${DB_NAME//-/_}_restore_check"
ADMIN_URL="${URL%/*}/postgres"
pg_tool psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null
pg_tool psql "$ADMIN_URL" -qc "CREATE DATABASE \"$SCRATCH\"" >/dev/null
trap 'pg_tool psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null' EXIT

pg_tool pg_restore --no-owner --no-privileges -d "${URL%/*}/$SCRATCH" "${PG_DOCKER_IMAGE:+/}$FILE"

COUNT_SQL="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'transactions' t, count(*) n FROM transactions UNION ALL
  SELECT 'members', count(*) FROM members UNION ALL
  SELECT 'member_arrears', count(*) FROM member_arrears UNION ALL
  SELECT 'movement_types', count(*) FROM movement_types UNION ALL
  SELECT 'users', count(*) FROM users) c"

ORIGINAL="$(pg_tool psql "$URL" -tAc "$COUNT_SQL")"
RESTORED="$(pg_tool psql "${URL%/*}/$SCRATCH" -tAc "$COUNT_SQL")"
echo "Original:   $ORIGINAL"
echo "Restaurado: $RESTORED"
if [[ "$ORIGINAL" != "$RESTORED" ]]; then
  echo "As contagens não batem: o backup NÃO está confiável." >&2
  exit 1
fi
echo "Restauração verificada."
