import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  elevation,
  emphasisOpacity,
  motion,
  shape,
  spacing,
  withAlpha,
} from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';

export interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Footer actions pinned below the scrollable body. */
  footer?: React.ReactNode;
  /** Hides the drag handle for sheets that are dismissed by their buttons. */
  showHandle?: boolean;
  /** Fraction of window height the sheet body may grow to. */
  maxHeightRatio?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Material 3 modal bottom sheet.
 *
 * On wide windows the sheet stops stretching edge-to-edge and centres itself at
 * a comfortable reading width — a full-bleed sheet on a tablet leaves the
 * buttons stranded in opposite corners.
 */
export default function BottomSheet({
  visible,
  onDismiss,
  title,
  subtitle,
  children,
  footer,
  showHandle = true,
  maxHeightRatio = 0.8,
  style,
  accessibilityLabel,
}: BottomSheetProps) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entering uses the decelerate curve and exiting the accelerate curve —
    // M3's asymmetry, which makes a sheet feel like it settles rather than
    // bounces.
    const curve = visible
      ? motion.easing.emphasizedDecelerate
      : motion.easing.emphasizedAccelerate;

    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion
        ? 0
        : visible
          ? motion.duration.medium4
          : motion.duration.short4,
      easing: Easing.bezier(curve[0], curve[1], curve[2], curve[3]),
      useNativeDriver: true,
    }).start();
  }, [visible, progress, reduceMotion]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height * 0.35, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onDismiss}
    >
      <View style={styles.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.scrim, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, emphasisOpacity.scrim] }) },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint="Dismisses this sheet"
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel ?? title}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceContainerLow,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              maxHeight: height * maxHeightRatio,
              transform: [{ translateY }],
              opacity: progress,
              ...elevation(1, colors.shadow),
            },
            // Wide windows get a centred, bounded sheet rather than a full-bleed one.
            width >= 600 && {
              width: 560,
              alignSelf: 'center',
              borderBottomLeftRadius: shape.extraLarge,
              borderBottomRightRadius: shape.extraLarge,
              marginBottom: spacing.xl,
            },
            style,
          ]}
        >
          {showHandle ? (
            <View style={styles.handleArea}>
              <View style={[styles.handle, { backgroundColor: withAlpha(colors.onSurfaceVariant, 0.4) }]} />
            </View>
          ) : (
            <View style={{ height: spacing.lg }} />
          )}

          {title ? (
            <View style={styles.header}>
              <Text variant="titleLarge" color={colors.onSurface} accessibilityRole="header">
                {title}
              </Text>
              {subtitle ? (
                <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    overflow: 'hidden',
  },
  handleArea: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: shape.full,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
});

/* ------------------------------------------------------------------ *
 * Dialog
 * ------------------------------------------------------------------ */

export interface DialogProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  /** Supporting text. Omit when `children` carries the content. */
  message?: string;
  children?: React.ReactNode;
  /** Action buttons, right-aligned per M3. */
  actions?: React.ReactNode;
  /** Prevents dismissal by tapping the scrim — for destructive confirmations. */
  dismissable?: boolean;
}

/**
 * Material 3 basic dialog. Used instead of `Alert.alert` wherever the app needs
 * a confirmation that matches the rest of the UI and respects the theme.
 */
export function Dialog({
  visible,
  onDismiss,
  title,
  message,
  children,
  actions,
  dismissable = true,
}: DialogProps) {
  const { colors, reduceMotion } = useTheme();
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: visible ? 1 : 0.9,
        duration: reduceMotion ? 0 : motion.duration.medium2,
        easing: Easing.bezier(...motion.easing.emphasizedDecelerate),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: reduceMotion ? 0 : motion.duration.short4,
        easing: Easing.bezier(...motion.easing.standard),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, scale, opacity, reduceMotion]);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onDismiss}
    >
      <View style={dialog.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.scrim,
              opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [0, emphasisOpacity.scrim] }),
            },
          ]}
        >
          {dismissable ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss dialog"
            />
          ) : null}
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={[
            dialog.container,
            {
              backgroundColor: colors.surfaceContainerHigh,
              transform: [{ scale }],
              opacity,
              ...elevation(3, colors.shadow),
            },
          ]}
        >
          <Text variant="headlineSmall" color={colors.onSurface} accessibilityRole="header">
            {title}
          </Text>
          {message ? (
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={dialog.message}>
              {message}
            </Text>
          ) : null}
          {children ? <View style={dialog.content}>{children}</View> : null}
          {actions ? <View style={dialog.actions}>{actions}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const dialog = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    borderRadius: shape.extraLarge,
    padding: spacing.xl,
  },
  message: {
    marginTop: spacing.lg,
  },
  content: {
    marginTop: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
});
