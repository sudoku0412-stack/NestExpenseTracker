import React, { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './ui/Button';
import { Theme, useStyles, useTheme } from '../constants/theme';
import { useT } from '../lib/I18nContext';
import { getWhatsNewSeenVersion, setWhatsNewSeenVersion } from '../lib/secureStorage';
import { currentAppVersion, decideWhatsNew, WHATS_NEW } from '../lib/whatsNew';

const makeStyles = (t: Theme) => ({
  root: { flex: 1, backgroundColor: t.colors.background, padding: t.spacing.lg },
  skipRow: { alignItems: 'flex-end' as const, minHeight: 40 },
  body: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 16 },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: t.colors.surfaceHigh,
  },
  heading: {
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.xs,
    color: t.colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  title: {
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.xl,
    color: t.colors.textPrimary,
    textAlign: 'center' as const,
  },
  text: {
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.md,
    color: t.colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 22,
  },
  badge: {
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.xs,
    color: t.colors.accent,
    borderWidth: 1,
    borderColor: t.colors.accent,
    borderRadius: t.radius.full,
    paddingHorizontal: 10,
    paddingVertical: 2,
    overflow: 'hidden' as const,
  },
  dots: { flexDirection: 'row' as const, justifyContent: 'center' as const, gap: 6, marginBottom: 16 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.colors.border },
  dotActive: { backgroundColor: t.colors.accent, width: 18 },
});

/** One-time "What's new" tour for the installed version. Shows the first
 *  time the app opens after an update (never for brand-new installs — the
 *  onboarding completion records the version), then never again. */
export function WhatsNewModal() {
  const t = useT();
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const version = currentAppVersion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decision = decideWhatsNew(await getWhatsNewSeenVersion(), version);
        if (decision === 'mark') await setWhatsNewSeenVersion(version);
        if (decision === 'show' && !cancelled) setVisible(true);
      } catch {
        // storage unavailable: skip the tour rather than risk nagging
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const slides = WHATS_NEW[version] ?? [];
  if (!visible || slides.length === 0) return null;

  const slide = slides[Math.min(index, slides.length - 1)];
  const last = index >= slides.length - 1;

  // Record on dismiss (not on show) so a force-quit mid-tour shows it again.
  const finish = () => {
    setVisible(false);
    setWhatsNewSeenVersion(version).catch(() => {});
  };

  return (
    <Modal visible animationType="slide" onRequestClose={finish} testID="whats-new">
      <SafeAreaView style={styles.root}>
        <View style={styles.skipRow}>
          {!last ? <Button label={t('skip')} variant="ghost" size="sm" onPress={finish} /> : null}
        </View>
        <View style={styles.body}>
          <Text style={styles.heading}>{t('wnHeading', { version })}</Text>
          <View style={styles.iconWrap}>
            <Ionicons name={slide.icon} size={44} color={theme.colors.accent} />
          </View>
          <Text style={styles.title} testID="whats-new-title">
            {t(slide.title)}
          </Text>
          {slide.premium ? <Text style={styles.badge}>{t('premium')}</Text> : null}
          <Text style={styles.text}>{t(slide.body)}</Text>
        </View>
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === index ? styles.dotActive : null]} />
          ))}
        </View>
        <Button
          label={last ? t('wnGotIt') : t('next')}
          onPress={last ? finish : () => setIndex(index + 1)}
        />
      </SafeAreaView>
    </Modal>
  );
}
