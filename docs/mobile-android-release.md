# Android production release (.aab) — runbook

How to produce the Play Store bundle for the owner app (`app/`, `tejotime-mobile`).

**First-release status (2026-09-11):** config is correct and every local check passes, but the
build has **not** been run — it needs an EAS login and a one-time keystore decision that only the
account holder can make. See §2.

---

## 1. The command

```bash
cd app
npx eas login          # once per machine
npm run eas:prod       # → eas build --platform android --profile production
```

That is the whole build. It runs in EAS's cloud, not on this machine, and produces a **.aab**.

**Why an `.aab` and not an `.apk`:** `eas.json`'s `development` and `preprod` profiles set
`android.buildType: "apk"` explicitly; `production` deliberately does not, and EAS's default for a
store-distribution Android build is `app-bundle`. Do not add a `buildType` to the production
profile — Google Play has required App Bundles for new apps since August 2021.

**`npm run build:prod` is NOT this.** That script (`scripts/build-android.sh`) builds a local
release APK signed with the **debug** keystore. It is for internal distribution only and Play will
reject it. Its own closing message says so.

---

## 2. The keystore — read this before the first build

Android signs every release with an upload key. **Google Play binds your app's package name to the
first key you upload, permanently.** Lose it without Play App Signing enrolled and you can never
ship an update to `com.tejotime.tejotimemobile` again — not a new build, not a hotfix. The only
remedy is publishing a brand-new listing and asking every user to reinstall.

On the first `eas build` for Android, EAS asks whether to generate a keystore. Say yes; it then
stores it against the project. Immediately afterwards:

```bash
npx eas credentials --platform android     # inspect, and download a backup
```

Back the downloaded keystore **and its passwords** up somewhere that survives losing this laptop
and this EAS account — a password manager entry or the company vault, not the repo. `app/.gitignore`
excludes `*.jks` / `credentials.json` for good reason; never commit them.

Also enrol in **Play App Signing** when creating the Play Console listing. It lets Google hold the
final signing key, so a lost *upload* key can be reset by support instead of ending the app. Do it
at listing creation — retrofitting later is harder.

---

## 3. Environment variables

The production profile declares `environment: "production"`, so a cloud build reads its variables
from the **EAS server-side environment**, not from any local `.env`. Local files only matter to
`scripts/build-android.sh`.

Confirm they exist before building:

```bash
npx eas env:list --environment production
```

They must match `app/.env.prod.example`:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_ENV` | `production` |
| `EXPO_PUBLIC_API_BASE_URL` | `https://api.tejotime.com/api/v1` |
| `EXPO_PUBLIC_SOCKET_URL` | `https://api.tejotime.com` |
| `EXPO_PUBLIC_WEB_URL` | `https://www.tejotime.com` |

Only `EXPO_PUBLIC_*` names reach the app — Metro inlines them at bundle time, and an unprefixed
name reads as `undefined`. Keep `EXPO_PUBLIC_WEB_URL` on the same origin as the backend's
`PUBLIC_WEB_URL`; between them they generate the QR and booking links that get printed on signage.

If a variable is missing, the build still succeeds and ships an app pointed at nothing. Check the
list rather than assuming.

---

## 4. Versioning

`eas.json` sets `cli.appVersionSource: "remote"` and the production profile sets
`autoIncrement: true`, so **EAS owns `versionCode`** and bumps it on every production build. The
`android.versionCode: 2` in `app.json` is not what ships; it is a leftover local value and editing
it changes nothing for a cloud build.

`version` in `app.json` (`1.0.2`) is the user-visible versionName. Bump that by hand when the
release deserves a new number.

Play rejects a `versionCode` it has already seen, which is exactly what `autoIncrement` prevents.

---

## 5. Pre-flight — run before every release

All four pass as of 2026-09-11:

```bash
cd app
npx tsc --noEmit          # clean
npx expo lint             # clean
npx expo-doctor           # see §6 — 2 known findings, neither a blocker
cd .. && npm run test:responsive   # 1262 assertions across 11 devices
```

---

## 6. Known findings from `expo-doctor` (neither blocks the build)

**Hermes V1 memory regression.** SDK 56 with `expo@56.0.14` ships Hermes `250829098.0.10`; the fix
landed in `.0.16`, which only exists in SDK 57 / React Native 0.86.2. Shipping on SDK 56 is
possible and common, but it carries a known memory regression. Upgrading to SDK 57 before a first
release is a real decision with its own regression risk — **make it deliberately, not as a
side effect of a release.**

**14 packages behind their SDK-56 pins.** All patch-level except `react-native-screens`
(`4.25.2` vs `~4.26.0`, a minor). `npx expo install --check` reviews, `--fix` aligns them.
Aligning is normal hygiene, but it changes dependencies, so do it as its own change with a test
pass rather than in the same breath as the first production build.

---

## 7. After the build

EAS prints a build URL and a download link for the `.aab`.

```bash
npx eas build:list --platform android --limit 5    # find it again later
```

For the first Play Console upload: create the app listing, enrol in Play App Signing (§2), then
upload the `.aab` to Internal testing first. Only promote to Production once the internal track
has been installed and opened on a real device — this repo has **no automated mobile tests and no
device coverage** (CLAUDE.md §12), so a human opening the app is the only end-to-end check that
exists.

Submission can later be automated with `eas submit --platform android --profile production`; the
`submit.production` block in `eas.json` is currently empty and would need the service-account key.

---

## 8. iOS

Out of scope here. `app.json` already carries `ios.bundleIdentifier` and the iPad orientation
plist, but no iOS release has been cut and there is no Apple Developer account step documented
yet. See [ios-local-setup.md](ios-local-setup.md) for running it locally.
