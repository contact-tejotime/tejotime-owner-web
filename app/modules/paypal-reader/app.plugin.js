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
 *             resolves this module's transitive dependencies with its own repositories), and the
 *             `META-INF/*.kotlin_module` packaging exclusion PayPal's SDK needs.
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
  withInfoPlist,
  withProjectBuildGradle,
} = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

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

const REPO = `    maven {
      url = uri("https://maven.pkg.github.com/iZettle/sdk-android")
      credentials(HttpHeaderCredentials) {
        name = "Authorization"
        value = "Bearer \${System.getenv('GITHUB_PACKAGES_TOKEN') ?: (project.findProperty('zettleGithubToken') ?: '')}"
      }
      authentication {
        header(HttpHeaderAuthentication)
      }
    }`;

function withAndroidRepository(config) {
  return withProjectBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') return c;
    c.modResults.contents = mergeContents({
      src: c.modResults.contents,
      newSrc: REPO,
      tag: 'paypal-reader-repository',
      anchor: /allprojects\s*\{\s*repositories\s*\{/,
      offset: 1,
      comment: '//',
    }).contents;
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

module.exports = function withPaypalReader(config, options = {}) {
  const { scheme, host } = parseRedirect(options.redirectUrl || DEFAULT_REDIRECT);
  config = withIos(config, { scheme, externalAccessory: options.externalAccessory === true });
  config = withAndroidOAuthActivity(config, { scheme, host });
  config = withAndroidRepository(config);
  config = withAndroidPackaging(config);
  return config;
};
