import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shape, spacing } from '../constants/m3';
import { useTheme } from '../context/ThemeContext';
import { Button, Text } from './m3';

interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Renders inline (no flex-fill) for use inside a scrolling list. */
  compact?: boolean;
}

/**
 * Material 3 empty state.
 *
 * The icon sits in a tonal circle rather than floating on the background, which
 * gives the block a visual anchor, and the whole thing is one accessibility
 * node so it is announced as a single message.
 */
export default function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.container, compact && styles.compact]}
      accessible
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={[styles.iconCircle, { backgroundColor: colors.surfaceContainerHighest }]}>
        <Ionicons name={icon as any} size={32} color={colors.onSurfaceVariant} />
      </View>

      <Text variant="titleMedium" color={colors.onSurface} style={styles.center}>
        {title}
      </Text>
      <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.center}>
        {subtitle}
      </Text>

      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="tonal"
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  compact: {
    // Not `flex: 0`: on React Native Web that resolves to `flex-basis: 0%`
    // with no grow, collapsing the block to zero height so its content spills
    // over whatever follows it.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  center: {
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.md,
  },
});
