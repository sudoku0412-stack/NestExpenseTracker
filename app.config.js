const withGooglePlayAdiToken = require('./plugins/withGooglePlayAdiToken');
const withGradleJvmHeap = require('./plugins/withGradleJvmHeap');
const withAndroidPredictiveBack = require('./plugins/withAndroidPredictiveBack');

module.exports = ({ config }) => {
  return withAndroidPredictiveBack(withGradleJvmHeap(withGooglePlayAdiToken({
    ...config,
    // Matches the App Store Connect listing name — "Receiptly" wasn't
    // available there, so this is the name going forward on both
    // platforms (not just a display-name mismatch with the store
    // listing). `slug` stays as-is since it's tied to the existing EAS
    // project/URLs, not user-visible.
    name: 'NestExpenseTracker',
    slug: 'receipt-scanner',
    version: '1.0.9',
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/bbdefab5-4cc5-4480-96a9-8ece7eb913a5',
      fallbackToCacheTimeout: 0,
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#0F172A',
    },
    ios: {
      // ios/ is now tracked in git (a real Xcode project checked in —
      // see the git history), so EAS treats this platform as "bare",
      // where the top-level policy-based runtimeVersion below is
      // rejected outright: "You're currently using the bare workflow,
      // where runtime version policies are not supported. You must
      // set your runtime version manually." That error was failing
      // EVERY iOS build attempt before it ever reached Xcode — no iOS
      // build (cloud or local) has actually succeeded since ios/ was
      // tracked. Override with a literal string here; Android has no
      // checked-in native project (still EAS's fresh-every-time
      // prebuild), so the policy-based fallback below still applies
      // there.
      runtimeVersion: '1.0.0',
      supportsTablet: false,
      // NOT the same as the Android package (com.kaushikmajumder.
      // receiptscanner) — that exact string is locked to a different,
      // inaccessible Apple Developer account (likely from early local
      // Xcode personal-team signing before this app had a paid
      // account), so the iOS App Store build uses this pre-existing,
      // already-registered identifier instead. Android is untouched;
      // the two platforms' bundle/package ids don't need to match.
      bundleIdentifier: 'com.kaushikmajumder.receiptly',
      // Kept in sync BY HAND before each release build — same
      // caveat as android.versionCode below, and eas.json's
      // production profile now has autoIncrement disabled entirely
      // (it was silently ignoring this literal and recomputing its
      // own stale value every build, repeatedly colliding with
      // versions already live on TestFlight/Play). This dynamic
      // app.config.js literal is what actually gets used — it takes
      // precedence over app.json's ios.buildNumber, which is kept in
      // sync here purely for a human reader, not because anything
      // reads it.
      buildNumber: '48',
      googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
      infoPlist: {
        NSCameraUsageDescription:
          'NestExpenseTracker uses your camera to take a photo of a receipt, then automatically reads the merchant name, date, and total from that photo so you can track the expense without typing it in yourself.',
        NSPhotoLibraryUsageDescription:
          'NestExpenseTracker reads photos of receipts you choose from your library so it can automatically extract the merchant name, date, and total, the same way it does for a photo taken with the camera.',
        NSFaceIDUsageDescription: 'Use Face ID to quickly and securely unlock NestExpenseTracker.',
        // expo-contacts (Settings → "Add by phone contact") pulls this
        // in even though the app only ever reads the ONE contact the
        // user explicitly taps in the native picker — Apple still
        // requires the purpose string for the underlying API.
        NSContactsUsageDescription:
          'NestExpenseTracker needs contacts access to let you pick a household member to invite by phone number.',
        // Answers App Store Connect's export-compliance question ahead
        // of time — this app only uses standard HTTPS/TLS (Firebase,
        // Gemini, etc.), no custom/proprietary encryption, so it
        // qualifies as exempt and this can stay false.
        ITSAppUsesNonExemptEncryption: false,
      },
      // Phase 3 magic-link invites: an invite email arrives with a
      // link on our Firebase Hosting domain. iOS opens it directly
      // in the app via universal links once the apple-app-site-
      // association file lives at https://<domain>/.well-known/.
      associatedDomains: ['applinks:balancesheet-android.web.app'],
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        // Navy matching the new logo's own background. The foreground
        // PNG already fills edge-to-edge, so this only shows if a
        // device mask crops past the foreground.
        backgroundColor: '#3F5691',
      },
      // READ_MEDIA_IMAGES was here until Google Play's review flagged it
      // (v1.0.4 review, versionCode 12) — Play policy only allows broad
      // photo/video permissions when the system picker is technically
      // insufficient, and it isn't here (see pickFromGallery in
      // app/(tabs)/scan.tsx, which never requests it and relies on
      // launchImageLibraryAsync's own system picker instead). Dropped
      // this app's own explicit READ_EXTERNAL_STORAGE too, since it was
      // always redundant — expo-image-picker's own AndroidManifest.xml
      // already declares it for pre-API-33 fallback regardless of what's
      // listed here, so removing it from THIS array doesn't change the
      // final merged manifest, just this app's own (unnecessary) ask.
      permissions: [
        'android.permission.CAMERA',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ],
      package: 'com.kaushikmajumder.receiptscanner',
      // Kept in sync BY HAND before each release build — see the
      // buildNumber comment above (autoIncrement is off; this literal
      // is the one actually used).
      versionCode: 29,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
      // Phase 3 magic-link invites: paired with the iOS associated
      // domain above. autoVerify=true makes Android verify the
      // assetlinks.json file on the hosting domain at install time
      // and route matching URLs directly to the app.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: 'balancesheet-android.web.app',
              pathPrefix: '/invite',
            },
            // Password-reset deep link (lib/auth.ts's sendPasswordReset)
            // — same App Link setup as /invite above.
            {
              scheme: 'https',
              host: 'balancesheet-android.web.app',
              pathPrefix: '/reset-password',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    plugins: [
      'expo-asset',
      'expo-router',
      'expo-secure-store',
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      [
        'expo-camera',
        {
          cameraPermission:
            'NestExpenseTracker uses your camera to take a photo of a receipt, then automatically reads the merchant name, date, and total from it.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'NestExpenseTracker reads photos of receipts you choose from your library so it can automatically extract the merchant name, date, and total.',
        },
      ],
      '@react-native-community/datetimepicker',
      // Sets up the iOS aps-environment entitlement needed for remote
      // push (household activity alerts) — local-only notifications
      // worked without this, but real push via Expo's push service
      // needs it. Also needs `eas credentials` run once to upload an
      // APNs key from the Apple Developer account for iOS builds.
      'expo-notifications',
      'expo-apple-authentication',
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
            // Some pods pulled in this session (Firebase messaging/
            // datetimepicker) require a higher minimum iOS version
            // than Expo SDK 52's own default — bump it explicitly
            // rather than letting CocoaPods pick per-pod minimums.
            deploymentTarget: '16.0',
          },
          android: {
            // Google Play requires targeting API 36 (Android 16) by
            // Aug 31 2026 or the app can no longer be updated —
            // flagged in Play Console's Policy status. compileSdk
            // must be >= targetSdk so both bump together. buildTools
            // 36.0.0 matches the SDK version.
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
            // Google Play also requires 16 KB memory page size support
            // (enforced since Oct 31 2025) — flagged alongside the API
            // 36 target in Policy status. Was NOT fixable here under
            // SDK52 (this plugin's PluginConfigTypeAndroid has no
            // `ndkVersion` option, so setting one here was silently
            // ignored) — needed a hand-written config plugin
            // (plugins/withNdk27.js) that patched android/build.gradle
            // directly. As of the SDK53/RN0.79 upgrade, react-native
            // itself now pins ndkVersion 27.1.12297006 (16 KB-aligned)
            // by default via its own libs.versions.toml, so that plugin
            // is gone — no override needed here or anywhere else.
            //
            // No explicit kotlinVersion override either, as of the same
            // upgrade: the old override (1.9.25, needed for SDK52's
            // Compose Compiler mismatch) started failing SDK53's
            // expo-updates KSP task with a ChangedFiles/KspTaskJvm
            // NoSuchMethodError — the bundled KSP now expects a newer
            // Kotlin than 1.9.25 provides. SDK53's own default already
            // satisfies every consumer that needed bumping under SDK52.
            // R8/shrinking off by default in Expo builds — Play
            // Console flagged "App optimization: Low" with no
            // shrink/obfuscation numbers. Enabling both turns on R8.
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            // @react-native-community/datetimepicker ships no proguard
            // rules of its own (unlike Expo modules, which are covered
            // by expo-modules-core's bundled rules) — R8 was silently
            // stripping its TurboModule spec classes (package is
            // com.reactcommunity.rndatetimepicker; RN's own bundled
            // proguard-rules.pro keeps classic NativeModule implementers
            // but not the TurboModule marker interface these use), which
            // is why the recurring-expense date picker stopped opening
            // once R8 shrinking was turned on above.
            extraProguardRules: `
-keep class com.reactcommunity.rndatetimepicker.** { *; }
-keep class * implements com.facebook.react.turbomodule.core.interfaces.TurboModule { *; }
-keep class * implements com.facebook.react.bridge.ReactPackage { *; }
`,
          },
        },
      ],
    ],
    experiments: { typedRoutes: true },
    scheme: 'receipt-scanner',
    extra: {
      eas: { projectId: 'bbdefab5-4cc5-4480-96a9-8ece7eb913a5' },
      googleWebClientId:
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
        '858326644205-etreldr96iispa3mr6cv6vcfv1ivukf1.apps.googleusercontent.com',
      // Gemini API key for AI-powered classification — sourced from the
      // EAS sensitive env var GEMINI_API_KEY at build/update time so the
      // raw value never lives in this repo. Restricted server-side to
      // this app's package + SHA-1 so an extracted key can't be abused
      // outside the app.
      geminiApiKey: process.env.GEMINI_API_KEY,
      // RevenueCat public SDK keys — these are public by design (RC's
      // own docs: safe to embed client-side, distinct from the secret
      // key used only in RC's own dashboard/API). Android and iOS use
      // different keys because they're scoped to separate RC "apps"
      // within the same project. Empty/undefined is a valid
      // not-configured-for-this-platform state — lib/entitlements.ts's
      // configurePurchases no-ops on it rather than throwing — which is
      // exactly what made a real bug silent: a manual `git pull` +
      // Xcode Archive (no `eas build`, no env var injection) baked in
      // `undefined` and the paywall quietly showed no plans, on a build
      // that otherwise looked completely normal. Since these keys are
      // safe to hardcode, a literal fallback removes that whole failure
      // mode — env var still wins when EAS sets one, so CI/EAS builds
      // are unaffected either way. If either key is ever rotated (e.g.
      // compromise, RC project migration), update BOTH the EAS env var
      // AND this literal — otherwise a build made without the env var
      // set silently falls back to the OLD key instead of failing
      // loudly, the same class of silent-misconfiguration bug this
      // fallback exists to prevent. (Also update the matching literals
      // in __tests__/appConfigRevenueCatKeys.test.ts.)
      revenueCatApiKeyAndroid: process.env.REVENUECAT_API_KEY_ANDROID ?? 'goog_LUmSeXyOBnDtiRDjxocSgYvmrRN',
      revenueCatApiKeyIos: process.env.REVENUECAT_API_KEY_IOS ?? 'appl_IWUzaIJgGCmISLeoYdTuzjQNJxc',
      // Optional: a Cloudflare Worker that wraps Workers AI as a free
      // fallback when the shared Gemini quota is exhausted. Set
      // PARSE_ENDPOINT to e.g. https://...workers.dev/parse and
      // PARSE_ENDPOINT_SECRET to the same secret the worker validates.
      // See scripts/parse-receipt-worker.ts for the deploy guide.
      parseEndpoint: process.env.PARSE_ENDPOINT,
      parseEndpointSecret: process.env.PARSE_ENDPOINT_SECRET,
      // EmailJS credentials for sending household-invite emails from
      // a connected Gmail account. All three are public by design —
      // EmailJS uses domain/rate-limit allow-listing for protection,
      // not key secrecy. Set via EAS env vars at build/update time.
      emailjsServiceId: process.env.EMAILJS_SERVICE_ID,
      emailjsTemplateId: process.env.EMAILJS_TEMPLATE_ID,
      emailjsPublicKey: process.env.EMAILJS_PUBLIC_KEY,
      // Cloudflare Worker that sends SMS phone invites via Twilio (the
      // Twilio secret itself lives only in that worker, never here).
      // See scripts/sms-invite-worker.ts for the deploy guide. Absent
      // means "not configured yet" — lib/phoneInvite.ts falls back to
      // in-app-only invites (still visible to the invitee once they
      // sign up and verify that phone number) when this is unset.
      smsWorkerEndpoint: process.env.SMS_WORKER_ENDPOINT,
      smsWorkerSecret: process.env.SMS_WORKER_SECRET,
    },
  })));
};
