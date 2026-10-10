#!/usr/bin/env bash
# Toolchain guard for the macOS runner: fail loudly rather than fall back to what macOS ships
# (bash 3.2, Python 3.9, Apple git). Reports EVERY violation, then fails, so one bad tool cannot
# hide another. Written to parse under bash 3.2, because that is what it must be able to report.
#
# Usage: bash toolchain_guard.sh <path to .nvmrc>
# Invoke it as `bash`, resolved through PATH, so the bash check tests what PATH actually gives.
nvmrc=${1:?usage: toolchain_guard.sh <path to .nvmrc>}
failures=0
violation() { echo "::error::$*"; failures=$((failures + 1)); }

echo "host=$(hostname -s) user=$(id -un) arch=$(uname -m)"

for tool in bash python3 git; do
  path=$(command -v "$tool") || { violation "$tool is not on PATH"; continue; }
  echo "$tool -> $path"
  case "$path" in
    /opt/homebrew/*) ;;
    *) violation "$tool resolved to $path, not Homebrew" ;;
  esac
done

[ "${BASH_VERSINFO[0]}" -ge 5 ] || violation "bash $BASH_VERSION is older than 5"

python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 14) else 1)' 2>/dev/null ||
  violation "$(python3 --version 2>&1) is older than 3.14"

if [ ! -r "$nvmrc" ]; then
  violation "cannot read $nvmrc"
elif ! have=$(node -p 'process.versions.node.split(".")[0]' 2>&1); then
  violation "node did not run: $have"
else
  want=$(tr -d '[:space:]' < "$nvmrc")
  [ "$have" = "$want" ] || violation "node $have is running, $nvmrc says $want"
fi

# npm is reported, not pinned: on Gitea it is Homebrew's global npm, not the one bundled with Node,
# so it can change underneath CI. Printing it makes such a change visible in the log.
if npm_version=$(npm --version 2>&1); then
  echo "npm -> $(command -v npm) $npm_version"
else
  violation "npm did not run: $npm_version"
fi

if [ "$failures" -gt 0 ]; then
  echo "::error::toolchain guard: $failures violation(s)"
  exit 1
fi
echo "bash $BASH_VERSION  $(python3 --version)  $(git --version)  node $(node --version)  npm $npm_version"
