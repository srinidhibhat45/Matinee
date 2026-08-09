import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, AppStateStatus, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, motion, shape, spacing } from '../constants/m3';
import { useTheme } from '../context/ThemeContext';
import { Button, IconButton, Text } from './m3';
import { applyUpdate, fetchUpdateIfAvailable, isUpdateSupported } from '../services/updates';

/** Don't re-check more than once every 15 minutes on foreground. */
const MIN_CHECK_INTERVAL = 15 * 60 * 1000;

/**
 * Silently checks for an OTA update on launch and whenever the app returns to
 * the foreground. Once a new bundle is downloaded and staged, a dismissible
 * banner invites the user to restart into it.
 *
 * The check is deliberately quiet: nothing shows while checking, and failures
 * (offline, server down) never surface.
 */
export default function UpdateBanner() {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const [updateReady, setUpdateReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const slideAnim = useRef(new Animated.Value(-160)).current;
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (!isUpdateSupported() || checkingRef.current) return;
    if (Date.now() - lastCheckRef.current < MIN_CHECK_INTERVAL) return;

    checkingRef.current = true;
    lastCheckRef.current = Date.now();
    try {
      const ready = await fetchUpdateIfAvailable();
      if (ready) {
        setUpdateReady(true);
        setDismissed(false);
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    runCheck();

    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') runCheck();
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [runCheck]);

  useEffect(() => {
    const shown = updateReady && !dismissed;
    Animated.timing(slideAnim, {
      toValue: shown ? 0 : -180,
      duration: reduceMotion ? 0 : motion.duration.medium4,
      easing: Easing.bezier(...([...motion.easing.emphasizedDecelerate] as [number, number, number, number])),
      useNativeDriver: true,
    }).start();
  }, [updateReady, dismissed, slideAnim, reduceMotion]);

  const handleRestart = useCallback(async () => {
    setApplying(true);
    try {
      await applyUpdate();
    } catch {
      // reloadAsync only rejects if the update can't be launched; keep the
      // banner up so the user can retry or dismiss it.
      setApplying(false);
    }
  }, []);

  if (!updateReady) return null;

  return (
    <Animated.View
      pointerEvents={dismissed ? 'none' : 'box-none'}
      accessibilityLiveRegion="polite"
      style={[
        styles.wrapper,
        {
          paddingTop: Math.max(insets.top, spacing.md) + spacing.xs,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View
        style={[
          styles.banner,
          {
            backgroundColor: colors.secondaryContainer,
            ...elevation(3, colors.shadow),
          },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.surfaceContainerLowest }]}>
          <Ionicons name="sparkles" size={18} color={colors.primary} />
        </View>

        <View style={styles.copy}>
          <Text variant="titleSmall" color={colors.onSecondaryContainer}>
            Update ready
          </Text>
          <Text variant="bodySmall" color={colors.onSecondaryContainer} numberOfLines={2}>
            Restart to get the latest version of Matinee.
          </Text>
        </View>

        <Button
          label="Restart"
          variant="filled"
          size="small"
          loading={applying}
          onPress={handleRestart}
          accessibilityLabel="Restart to apply the update"
        />

        <IconButton
          icon="close"
          size={40}
          iconSize={20}
          disabled={applying}
          color={colors.onSecondaryContainer}
          onPress={() => setDismissed(true)}
          accessibilityLabel="Dismiss update banner"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    zIndex: 9999,
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    maxWidth: 560,
    borderRadius: shape.large,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 1,
  },
});
