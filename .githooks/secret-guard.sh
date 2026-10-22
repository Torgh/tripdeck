#!/bin/sh
# Refuses to commit or push any secret value from .env.local.
# Usage: secret-guard.sh <text to scan on stdin> ; exits 1 when a secret is found.
env_file="$(git rev-parse --show-toplevel)/.env.local"
[ -f "$env_file" ] || exit 0
input=$(cat)
found=0
while IFS='=' read -r name value; do
  case "$name" in ''|\#*) continue ;; esac
  value=$(printf '%s' "$value" | tr -d '"\r' | sed 's/^ *//;s/ *$//')
  # Only real secrets: long values of keys, secrets and tokens.
  case "$name" in *KEY*|*SECRET*|*TOKEN*|*PASSWORD*) ;; *) continue ;; esac
  [ ${#value} -ge 16 ] || continue
  if printf '%s' "$input" | grep -qF "$value"; then
    echo "secret-guard: the value of $name from .env.local is in what you are about to $1. Remove it." >&2
    found=1
  fi
done < "$env_file"
exit $found
