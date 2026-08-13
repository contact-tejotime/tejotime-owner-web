#!/usr/bin/env bash
#
# Local release APK for a chosen backend.
#
#   ./scripts/build-android.sh preprod|prod [--pull]
#
# Where the values come from, highest priority first:
#
#   1. Shell environment      — per variable, so CI can override a single host.
#   2. .env.preprod / .env.production   — gitignored; `--pull` writes these from EAS.
#   3. .env.preprod.example / .env.prod.example — committed templates, so a fresh
#      clone builds without an EAS login.
#
# EAS is the canonical source for cloud builds (eas.json carries only an `environment`
# pointer, never URLs). `--pull` refreshes the local file from that same source.
#
# Two traps make an "obvious" gradle invocation ship the wrong backend, and both are handled here:
#
#  1. `.env.local` is loaded in every mode except test and outranks `.env`, so a developer with a
#     localhost `.env.local` gets a localhost release build with no warning. Rather than depend on
#     which dotfile wins, this stages exactly ONE `.env` for the build and restores the originals
#     afterwards, so precedence never enters into it.
#
#  2. Gradle does not treat environment variables as task inputs. `createBundleReleaseJsAndAssets`
#     therefore reports UP-TO-DATE and repackages the previous JS bundle — the build "succeeds" in
#     seconds and the APK still points at the old backend. Its real output dirs are deleted first.
#
# The build is then verified against the shipped bytecode, because BUILD SUCCESSFUL does not mean
# the bundle was rebuilt. Never trust the exit code alone here.
#
# Note: only EXPO_PUBLIC_* names reach the app. Metro inlines statically-referenced
# `process.env.EXPO_PUBLIC_X` at bundle time; an unprefixed name would read as undefined.
set -euo pipefail

TARGET="${1:-}"
PULL="${2:-}"
case "$TARGET" in
  # EAS environments are fixed (development|preview|production) unless on an Enterprise plan,
  # so the preprod PROFILE maps onto the `preview` ENVIRONMENT. Profile names are free-form.
  preprod) EAS_ENV="preview";     LOCAL_ENV=".env.preprod";    EXAMPLE_ENV=".env.preprod.example" ;;
  prod)    EAS_ENV="production";  LOCAL_ENV=".env.production"; EXAMPLE_ENV=".env.prod.example" ;;
  *) echo "usage: $0 preprod|prod [--pull]" >&2; exit 2 ;;
esac

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# Snapshot the shell BEFORE sourcing anything, so file values cannot mask a deliberate override.
SH_ENV="${EXPO_PUBLIC_ENV:-}"
SH_API="${EXPO_PUBLIC_API_BASE_URL:-}"
SH_SOCKET="${EXPO_PUBLIC_SOCKET_URL:-}"
SH_WEB="${EXPO_PUBLIC_WEB_URL:-}"

# Restore whatever was here before, on success, failure or Ctrl-C alike. Without this an aborted
# build leaves the developer's .env.local stashed and their next `expo start` hits the wrong API.
STASH=".env-build-stash"
restore() {
  for f in .env .env.local; do
    rm -f "$APP_DIR/$f"
    if [ -f "$APP_DIR/$STASH/$f" ]; then mv -f "$APP_DIR/$STASH/$f" "$APP_DIR/$f"; fi
  done
  rmdir "$APP_DIR/$STASH" 2>/dev/null || true
  return 0  # an EXIT trap's status would otherwise leak into the script's own exit code
}
trap restore EXIT INT TERM

rm -rf "$STASH"; mkdir -p "$STASH"
for f in .env .env.local; do
  if [ -f "$f" ]; then mv "$f" "$STASH/$f"; fi
done

# Deliberately after the stash: `eas env:pull` writes to .env, which would otherwise overwrite the
# developer's own file. With .env already moved aside there is nothing to clobber.
if [ "$PULL" = "--pull" ]; then
  echo ">>> pulling $EAS_ENV variables from EAS"
  eas env:pull --environment "$EAS_ENV"
  mv -f .env "$LOCAL_ENV"
  echo ">>> wrote $LOCAL_ENV"
fi

SOURCE=""
for c in "$LOCAL_ENV" "$EXAMPLE_ENV"; do
  if [ -f "$c" ]; then SOURCE="$c"; set -a; . "./$c"; set +a; break; fi
done

# Shell wins per variable, applied after the file so a single exported host can override one line.
# Written as `if` rather than `[ -n x ] && y=z`: under `set -e` the latter returns 1 when the test
# is false, which aborts the script.
if [ -n "$SH_ENV" ];    then EXPO_PUBLIC_ENV="$SH_ENV"; fi
if [ -n "$SH_API" ];    then EXPO_PUBLIC_API_BASE_URL="$SH_API"; fi
if [ -n "$SH_SOCKET" ]; then EXPO_PUBLIC_SOCKET_URL="$SH_SOCKET"; fi
if [ -n "$SH_WEB" ];    then EXPO_PUBLIC_WEB_URL="$SH_WEB"; fi

: "${EXPO_PUBLIC_ENV:=}" "${EXPO_PUBLIC_API_BASE_URL:=}" "${EXPO_PUBLIC_SOCKET_URL:=}" "${EXPO_PUBLIC_WEB_URL:=}"
if [ -z "$EXPO_PUBLIC_API_BASE_URL" ]; then
  echo "error: no EXPO_PUBLIC_API_BASE_URL." >&2
  echo "       export it, or create $LOCAL_ENV (try: $0 $TARGET --pull)." >&2
  exit 1
fi

API_HOST="$(printf '%s' "$EXPO_PUBLIC_API_BASE_URL" | sed -E 's#^https?://##; s#/.*##')"

echo ">>> target : $TARGET"
echo ">>> source : ${SOURCE:-shell environment}${SH_API:+ (api host overridden by shell)}"
echo ">>> api    : $API_HOST"

# One deterministic .env, written from the resolved values rather than copied, so precedence is
# already settled by the time Metro reads anything.
{
  echo "EXPO_PUBLIC_ENV=$EXPO_PUBLIC_ENV"
  echo "EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL"
  echo "EXPO_PUBLIC_SOCKET_URL=$EXPO_PUBLIC_SOCKET_URL"
  echo "EXPO_PUBLIC_WEB_URL=$EXPO_PUBLIC_WEB_URL"
} > .env

cd android
# The bundle task's outputs. NOT `generated/assets/createBundleReleaseJsAndAssets` — that is the
# task name, not the path, and deleting it silently no-ops.
rm -rf app/build/generated/assets/react/release \
       app/build/intermediates/assets/release \
       app/build/outputs/apk/release/app-release.apk
echo ">>> cleared stale JS bundle outputs"

./gradlew assembleRelease --console=plain

APK="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "error: gradle reported success but no APK at $APK" >&2; exit 1; }

# Verify against the bytecode that actually shipped. Metro inlines EXPO_PUBLIC_* at bundle time,
# so the host string is present iff the bundle was really rebuilt with this env.
BUNDLE="$(mktemp -t ttbundle)"
unzip -p "$APK" assets/index.android.bundle > "$BUNDLE"
fail=0
if ! LC_ALL=C grep -aqF "$API_HOST" "$BUNDLE"; then
  echo "FAIL: '$API_HOST' is absent from the shipped bundle — it was not rebuilt with this env." >&2
  fail=1
fi
if LC_ALL=C grep -aqE "localhost:(8080|3000)" "$BUNDLE"; then
  echo "FAIL: the shipped bundle still contains a localhost URL." >&2
  fail=1
fi
rm -f "$BUNDLE"
[ "$fail" -eq 0 ] || { echo "Refusing to report success. Do not distribute this APK." >&2; exit 1; }

# Gradle always writes the same app-release.apk, so a preprod build silently replaces a prod one
# and neither filename says which backend it targets. Keep a named copy so both can coexist and
# the target is legible from the filename.
#
# Deliberately OUTSIDE android/app/build/outputs: Gradle's stale-output cleanup deletes files it
# does not recognise from its own output dirs, so a copy left next to app-release.apk is silently
# removed by the following build.
OUT_DIR="$APP_DIR/build-apk"
mkdir -p "$OUT_DIR"
NAMED="$OUT_DIR/tejotime-$TARGET.apk"
cp -f "$APK" "$NAMED"

echo
echo "OK  $TARGET APK verified against $API_HOST"
echo "    $NAMED"
echo "    $(du -h "$NAMED" | cut -f1)"
echo
echo "NOTE: signed with the debug keystore (android/app/build.gradle). Fine for internal"
echo "      distribution; not uploadable to Play. Use 'npm run eas:prod' for a store build."
