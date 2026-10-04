import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { useTheme } from '../../constants/theme';

/**
 * Pulse-animated placeholder block for loading states. Renders as a
 * rectangle that fades between two background opacities so the user
 * sees the layout outline while data loads. Matches the active
 * theme (lighter pulse on light mode, darker on dark mode).
 */
export function Skeleton({
  width,
  height,
  borderRadius,
  style,
}: {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  borderRadius?: number;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: borderRadius ?? theme.radius.sm,
          backgroundColor: theme.colors.surfaceHigh,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Pre-built skeleton card for a receipt row. */
export function ReceiptCardSkeleton() {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Skeleton width={44} height={44} borderRadius={theme.radius.md} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width={'60%' as `${number}%`} height={14} />
        <Skeleton width={'40%' as `${number}%`} height={11} />
      </View>
      <Skeleton width={64} height={18} />
    </View>
  );
}

/** A stack of N receipt card skeletons. */
export function ReceiptListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: count }, (_, i) => (
        <ReceiptCardSkeleton key={i} />
      ))}
    </View>
  );
}
