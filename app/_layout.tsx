import 'react-native-get-random-values';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Manrope_300Light,
  Manrope_500Medium,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import {
  Roboto_100Thin,
  Roboto_300Light,
  Roboto_400Regular,
  Roboto_500Medium,
} from '@expo-google-fonts/roboto';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { initDatabase } from '../lib/database';
import { ThemeProvider, useTheme, getBootstrapTheme } from '../constants/theme';
import { I18nProvider } from '../lib/I18nContext';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import { EntitlementsProvider, useEntitlements } from '../lib/EntitlementsContext';
import { clearLiveRates, refreshLiveRates } from '../lib/exchangeRates';
import { notifyLocalDataChanged } from '../lib/dataSync';
import { ToastProvider } from '../components/ui/Toast';
import { hrefForAuthGuard } from '../lib/routeGuard';
import { scheduleRouteReplace } from '../lib/scheduleRouteReplace';

import { useT } from '../lib/I18nContext';
export default function RootLayout() {
  // Previously fire-and-forget — the rest of the app (Home's receipt
  // load, AuthContext's post-sign-in bootstrap) could start reading/
  // writing the DB before schema migrations in initDatabase() finished,
  // a latent race that got more likely to actually lose the more
  // migration statements got added over time (three new columns this
  // session alone). Gate rendering on it instead, same pattern as the
  // fontsLoaded check right below.
  const [dbReady, setDbReady] = useState(false);
  useEffect(() => {
    initDatabase()
      .catch(console.error)
      .finally(() => setDbReady(true));
  }, []);

  const [fontsLoaded] = useFonts({
    Manrope_300Light,
    Manrope_500Medium,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Roboto_100Thin,
    Roboto_300Light,
    Roboto_400Regular,
    Roboto_500Medium,
    RobotoMono_400Regular,
    RobotoMono_500Medium,
  });

  // Rendered before ThemeProvider mounts, so it can't read the
  // resolved (preference-aware) theme yet — falls back to the raw OS
  // scheme so a light-mode device doesn't flash dark here.
  const scheme = useColorScheme();

  if (!fontsLoaded || !dbReady) {
    const bootstrapTheme = getBootstrapTheme(scheme);
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bootstrapTheme.colors.background,
        }}
      >
        <ActivityIndicator color={bootstrapTheme.colors.textPrimary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <AuthProvider>
                <EntitlementsProvider>
                  <LiveRatesSync />
                  <ThemedStatusBar />
                  <RootStack />
                </EntitlementsProvider>
              </AuthProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Premium: keep currency conversion on daily live rates; everyone else
 *  (or a lapsed subscription) uses the fixed approximate table. */
function LiveRatesSync() {
  const { isPremium, loading } = useEntitlements();
  useEffect(() => {
    if (loading) return;
    if (!isPremium) {
      clearLiveRates();
      return;
    }
    let cancelled = false;
    refreshLiveRates()
      .then((live) => {
        if (live && !cancelled) notifyLocalDataChanged();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isPremium, loading]);
  return null;
}

function ThemedStatusBar() {
  const theme = useTheme();
  // Light-content (white icons) on dark background; dark-content on light.
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />;
}

function RootStack() {
  const t = useT();
  const theme = useTheme();
  const { initializing, user, onboardingSeen } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const userRef = useRef(user);
  const onboardingSeenRef = useRef(onboardingSeen);
  const segmentsRef = useRef(segments);
  userRef.current = user;
  onboardingSeenRef.current = onboardingSeen;
  segmentsRef.current = segments;

  useEffect(() => {
    if (initializing) return;
    const current = (segments[0] ?? '') as string;
    const href = hrefForAuthGuard({ user, onboardingSeen, current });
    if (!href) return;
    // Immediate replace is swallowed on iOS when Sign out's confirm
    // UIAlertController is still dismissing — schedule + retry so the
    // user actually lands on the sign-in screen. Skip the retry once
    // the guard is already satisfied (a second replace freezes taps).
    return scheduleRouteReplace(
      () => {
        router.replace(href as never);
      },
      () =>
        hrefForAuthGuard({
          user: userRef.current,
          onboardingSeen: onboardingSeenRef.current,
          current: (segmentsRef.current[0] ?? '') as string,
        }) === null,
    );
  }, [initializing, user, onboardingSeen, segments]);

  // Shared-expense/settle-up pushes carry data.screen: 'home' (see
  // lib/notifications.ts) — tapping one should jump straight to Home
  // (freshly reloaded — see app/(tabs)/index.tsx's AppState listener),
  // not just foreground whatever screen the app was left on. Covers
  // both a cold-start tap (checked once here) and a tap while the app
  // was already running/backgrounded (the listener).
  useEffect(() => {
    if (initializing) return;
    const goToTargetScreen = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { screen?: string } | undefined;
      if (data?.screen === 'home') {
        router.push('/(tabs)');
      }
    };
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) goToTargetScreen(response);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(goToTargetScreen);
    return () => subscription.remove();
  }, [initializing]);

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* NOT theme.colors.primary — dark navy on the near-black dark-mode
            background is invisible; accent has real contrast in both themes. */}
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  }

  const signedIn = !!user;

  return (
    <Stack
      // Remount the native stack on session flip so a sign-out replace
      // cannot leave react-native-screens in a half-transition where the
      // login UI paints but every control is dead.
      key={signedIn ? 'in' : 'out'}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontWeight: '700', color: theme.colors.textPrimary },
        contentStyle: { backgroundColor: theme.colors.background },
        freezeOnBlur: false,
      }}
    >
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings"
        options={{
          title: t('settings'),
          // Regular stack screen, not a modal sheet — navigates like
          // every other page (slide transition + back chevron) instead
          // of popping up as a separate overlay.
          headerStyle: { backgroundColor: theme.colors.surface },
        }}
      />
      <Stack.Screen
        name="edit/[id]"
        options={{
          title: t('editReceipt'),
          headerStyle: { backgroundColor: theme.colors.surface },
        }}
      />
      <Stack.Screen
        name="add-income"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="incomes"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="scan-paystub"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="savings-goals"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="budgets"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="investments"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="investment/[id]"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="edit-income/[id]"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="reports"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="edit-profile"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="balances"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="recurring"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="review"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="households"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="shared-expenses/[uid]"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="contacts-sync"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="paywall"
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
    </Stack>
  );
}

