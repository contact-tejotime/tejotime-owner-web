/**
 * Config plugin for the PayPal POS Card Reader module (docs/card-payments-paypal.md).
 *
 * Everything the native projects need that `npx expo prebuild` would otherwise throw away — they
 * are generated, never committed (app/.gitignore), so this is the only durable place for it:
 *
 *   iOS     — Bluetooth + location usage strings (the reader is Bluetooth; PayPal's SDK asks for
 *             location to scan), the `bluetooth-central` background mode, and the URL scheme
 *             PayPal's sign-in returns to.
 *   Android — PayPal's OAuth activity with the redirect scheme/host (from PayPal's example
 *             manifest), the GitHub Packages repository for the whole project (the app module
 *             resolves this module's transitive dependencies with its own repositories), the
 *             `META-INF/*.kotlin_module` packaging exclusion PayPal's SDK needs, and one set of
 *             backup rules covering both PayPal's SDK and expo-secure-store. All of it is skipped
 *             while this module's android/ folder is missing, since every piece names something
 *             only PayPal's SDK provides.
 *
 * NOT added: `UISupportedExternalAccessoryProtocols` / the `external-accessory` background mode.
 * They are only for PayPal's older Bluetooth-classic reader, and declaring them makes Apple ask the
 * accessory maker to register the app (MFi) before review. The PayPal Reader the client uses is
 * Bluetooth LE. Pass `externalAccessory: true` only if an old reader ever has to be supported.
 *
 * Option `redirectUrl` must equal EXPO_PUBLIC_PAYPAL_REDIRECT_URL (lib/config.ts) and the redirect
 * registered for both apps on PayPal's developer portal. Its scheme is its own — not `tejotime`,
 * which expo-router owns.
 */
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withInfoPlist,
  withProjectBuildGradle,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DEFAULT_REDIRECT = 'tejotime-paypal://login.callback';
const OAUTH_ACTIVITY = 'com.izettle.android.auth.OAuthActivity';

const BLUETOOTH_REASON =
  'TejoTime connects to your PayPal card reader over Bluetooth to take card payments.';
const LOCATION_REASON =
  "PayPal's card reader needs your location to find the reader and to take card payments safely.";

function parseRedirect(url) {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url);
  if (!match) throw new Error(`paypal-reader: redirectUrl "${url}" must look like scheme://host`);
  return { scheme: match[1], host: match[2] };
}

function withIos(config, { scheme, externalAccessory }) {
  return withInfoPlist(config, (c) => {
    const plist = c.modResults;
    plist.NSBluetoothAlwaysUsageDescription = plist.NSBluetoothAlwaysUsageDescription || BLUETOOTH_REASON;
    plist.NSBluetoothPeripheralUsageDescription = plist.NSBluetoothPeripheralUsageDescription || BLUETOOTH_REASON;
    plist.NSLocationWhenInUseUsageDescription = plist.NSLocationWhenInUseUsageDescription || LOCATION_REASON;

    const modes = new Set(plist.UIBackgroundModes || []);
    modes.add('bluetooth-central');
    if (externalAccessory) modes.add('external-accessory');
    plist.UIBackgroundModes = [...modes];
    if (externalAccessory) {
      const protocols = new Set(plist.UISupportedExternalAccessoryProtocols || []);
      protocols.add('com.izettle.cardreader-one');
      plist.UISupportedExternalAccessoryProtocols = [...protocols];
    }

    const types = plist.CFBundleURLTypes || [];
    if (!types.some((t) => (t.CFBundleURLSchemes || []).includes(scheme))) {
      types.push({ CFBundleURLSchemes: [scheme] });
    }
    plist.CFBundleURLTypes = types;
    return c;
  });
}

function withAndroidOAuthActivity(config, { scheme, host }) {
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.activity = (app.activity || []).filter((a) => a.$['android:name'] !== OAUTH_ACTIVITY);
    app.activity.push({
      $: {
        'android:name': OAUTH_ACTIVITY,
        'android:exported': 'true',
        'android:launchMode': 'singleTask',
        'android:taskAffinity': '@string/oauth_activity_task_affinity',
      },
      'intent-filter': [
        {
          data: [{ $: { 'android:scheme': scheme, 'android:host': host } }],
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
        },
      ],
    });
    return c;
  });
}

const REPO_TAG = '// @generated paypal-reader-repository';
const REPO = `    maven {
      url = uri("https://maven.pkg.github.com/iZettle/sdk-android")
      credentials(HttpHeaderCredentials) {
        name = "Authorization"
        value = "Bearer \${System.getenv('GITHUB_PACKAGES_TOKEN') ?: (project.findProperty('zettleGithubToken') ?: '')}"
      }
      authentication {
        header(HttpHeaderAuthentication)
      }
      // Only PayPal's artifacts are looked up here. This repository sits first, and GitHub answers
      // a missing or wrong token with 401, which Gradle treats as a hard failure rather than
      // "not here" — unfiltered, every dependency in the app would fail to resolve.
      content {
        includeGroupByRegex "com\\\\.i?zettle(\\\\..*)?"
      }
    }`;

function withAndroidRepository(config) {
  return withProjectBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') return c;
    // Not mergeContents: it tests its anchor against one line at a time, so a pattern spanning
    // `allprojects {` and `repositories {` never matches, and anchoring on either line alone
    // either lands outside `repositories` or on buildscript's (which only resolves plugins).
    const contents = c.modResults.contents;
    if (contents.includes(REPO_TAG)) return c;
    const anchor = /allprojects\s*\{\s*repositories\s*\{/;
    if (!anchor.test(contents)) {
      throw new Error('paypal-reader: no `allprojects { repositories { ... } }` in android/build.gradle');
    }
    c.modResults.contents = contents.replace(
      anchor,
      (m) => `${m}\n    ${REPO_TAG} (modules/paypal-reader/app.plugin.js)\n${REPO}`,
    );
    return c;
  });
}

function withAndroidPackaging(config) {
  return withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') return c;
    const block = `android {
  packagingOptions {
    // PayPal's Zettle SDK ships Kotlin module files that clash between its artifacts.
    exclude 'META-INF/*.kotlin_module'
  }
}`;
    if (!c.modResults.contents.includes("exclude 'META-INF/*.kotlin_module'")) {
      c.modResults.contents += `\n// @generated paypal-reader (modules/paypal-reader/app.plugin.js)\n${block}\n`;
    }
    return c;
  });
}

// PayPal's SDK and expo-secure-store each declare android:fullBackupContent on <application>, so
// the manifest merger refuses the build. Both exist for the same reason — encrypted credentials
// restored onto another phone cannot be decrypted there — so neither may simply win: these files
// are expo-secure-store's rules plus PayPal's one exclusion (com.zettle.sdk.internal:lib,
// res/xml/auth_backup_rules.xml). Keep them in step with both when either library is upgraded.
const BACKUP_RULES = 'tejotime_backup_rules';
const EXTRACTION_RULES = 'tejotime_data_extraction_rules';
const BACKUP_PATHS = `    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
    <exclude domain="sharedpref" path="PREFS_AUTH_URI.xml"/>`;

function withAndroidBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      await fs.promises.mkdir(dir, { recursive: true });
      const note = '<!-- @generated by modules/paypal-reader/app.plugin.js: expo-secure-store + PayPal SDK rules -->';
      await fs.promises.writeFile(
        path.join(dir, `${BACKUP_RULES}.xml`),
        `<?xml version="1.0" encoding="utf-8"?>\n${note}\n<!-- Android 11 and lower -->\n<full-backup-content>\n${BACKUP_PATHS}\n</full-backup-content>\n`,
      );
      const inner = BACKUP_PATHS.replace(/^/gm, '  ');
      await fs.promises.writeFile(
        path.join(dir, `${EXTRACTION_RULES}.xml`),
        `<?xml version="1.0" encoding="utf-8"?>\n${note}\n<!-- Android 12 and higher -->\n<data-extraction-rules>\n  <cloud-backup>\n${inner}\n  </cloud-backup>\n  <device-transfer>\n${inner}\n  </device-transfer>\n</data-extraction-rules>\n`,
      );
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:fullBackupContent'] = `@xml/${BACKUP_RULES}`;
    app.$['android:dataExtractionRules'] = `@xml/${EXTRACTION_RULES}`;
    const replace = new Set((app.$['tools:replace'] || '').split(',').filter(Boolean));
    replace.add('android:fullBackupContent');
    app.$['tools:replace'] = [...replace].join(',');
    return c;
  });
}

module.exports = function withPaypalReader(config, options = {}) {
  const { scheme, host } = parseRedirect(options.redirectUrl || DEFAULT_REDIRECT);
  config = withIos(config, { scheme, externalAccessory: options.externalAccessory === true });
  // The OAuth activity and its `@string/oauth_activity_task_affinity` come from PayPal's SDK, which
  // only the module's own android/ project pulls in. Without it the manifest names a class and a
  // string that do not exist and resource linking fails, so the build would carry no app at all
  // rather than an app without card charging (which card-reader.ts already handles).
  if (!fs.existsSync(path.join(__dirname, 'android', 'build.gradle'))) {
    console.warn('» paypal-reader: modules/paypal-reader/android is missing — Android build has no card reader');
    return config;
  }
  config = withAndroidOAuthActivity(config, { scheme, host });
  config = withAndroidRepository(config);
  config = withAndroidPackaging(config);
  config = withAndroidBackupRules(config);
  return config;
};
