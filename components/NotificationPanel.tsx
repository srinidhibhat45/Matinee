import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, Image, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { useResponsive } from '../hooks/useResponsive';
import { shape, spacing, withAlpha } from '../constants/m3';
import { Button, IconButton, Loading, Text, Touchable } from './m3';
import EmptyState from './EmptyState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inAppNotificationService, InAppNotification } from '../services/inAppNotifications';
import { getImageUrl } from '../services/tmdb';

interface NotificationPanelProps {
  visible: boolean;
  onClose: () => void;
  onRefreshCount?: () => void;
}

function formatRelativeTime(dateString: string): string {
  try {
    let cleanDateStr = dateString;
    if (dateString.includes(' ') && !dateString.includes('T')) {
      cleanDateStr = dateString.replace(' ', 'T') + 'Z';
    }
    const date = new Date(cleanDateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now'; // Handle minor clock drift
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
}

export default function NotificationPanel({ visible, onClose, onRefreshCount }: NotificationPanelProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const router = useRouter();
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const list = await inAppNotificationService.getAll(50);
      setNotifications(list);
    } catch (err) {
      console.warn('Error fetching in-app notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchNotifications();
    }
  }, [visible, fetchNotifications]);

  const handleMarkAsRead = useCallback(async (item: InAppNotification) => {
    try {
      if (!item.isRead) {
        await inAppNotificationService.markRead(item.id);
        // Optimistic UI update
        setNotifications(prev =>
          prev.map(n => (n.id === item.id ? { ...n, isRead: true } : n))
        );
        if (onRefreshCount) {
          onRefreshCount();
        }
      }
      
      // Navigate to detail page if tmdbId is present
      if (item.tmdbId) {
        onClose();
        router.push({
          pathname: '/detail/[id]',
          params: { id: String(item.tmdbId), mediaType: item.mediaType || 'movie' },
        });
      }
    } catch (err) {
      console.warn('Error marking notification as read:', err);
    }
  }, [onClose, onRefreshCount, router]);

  const handleClearAll = useCallback(async () => {
    try {
      await inAppNotificationService.clearAll();
      setNotifications([]);
      if (onRefreshCount) {
        onRefreshCount();
      }
    } catch (err) {
      console.warn('Error clearing notifications:', err);
    }
  }, [onRefreshCount]);

  const handleDismissSingle = useCallback(async (item: InAppNotification) => {
    try {
      await inAppNotificationService.dismiss(item.id);
      setNotifications(prev => prev.filter(n => n.id !== item.id));
      if (onRefreshCount) {
        onRefreshCount();
      }
    } catch (err) {
      console.warn('Error dismissing notification:', err);
    }
  }, [onRefreshCount]);

  /**
   * Category badge.
   *
   * Each kind maps to an M3 container/on-container pair, so the label always
   * clears contrast in both themes — the old version mixed hand-tuned rgba
   * fills with fixed foreground hexes and washed out in light mode.
   */
  const renderBadge = (type: string, providerName: string | null) => {
    const config: Record<string, { text: string; bg: string; fg: string }> = {
      new_release: {
        text: 'New release',
        bg: colors.primaryContainer,
        fg: colors.onPrimaryContainer,
      },
      ott_available: {
        text: providerName ? `Now on ${providerName}` : 'Streaming',
        bg: colors.secondaryContainer,
        fg: colors.onSecondaryContainer,
      },
      trending: {
        text: 'Trending',
        bg: colors.tertiaryContainer,
        fg: colors.onTertiaryContainer,
      },
    };

    const { text, bg, fg } = config[type] ?? {
      text: 'Update',
      bg: colors.surfaceContainerHighest,
      fg: colors.onSurfaceVariant,
    };

    return (
      <View style={[styles.badge, { backgroundColor: bg }]}>
        <Text variant="labelSmall" color={fg} maxFontSizeMultiplier={1.3}>
          {text}
        </Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: InAppNotification }) => {
    const posterUrl = getImageUrl(item.posterPath, 'w92');
    const time = formatRelativeTime(item.createdAt);

    return (
      <Touchable
        onPress={() => handleMarkAsRead(item)}
        stateLayerColor={colors.onSurface}
        accessibilityRole="button"
        accessibilityLabel={[
          item.isRead ? null : 'Unread',
          item.title,
          item.body,
          time,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={item.tmdbId ? 'Opens this title' : undefined}
        style={[
          styles.notificationCard,
          { borderBottomColor: colors.outlineVariant },
          // Unread rows get a faint primary wash — subtle enough not to shout,
          // and paired with the dot so colour is never the only signal.
          !item.isRead && { backgroundColor: withAlpha(colors.primary, 0.07) },
        ]}
      >
        <View style={styles.cardContent}>
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              style={styles.poster}
              resizeMode="cover"
              accessible={false}
            />
          ) : (
            <View
              style={[styles.poster, styles.center, { backgroundColor: colors.surfaceContainerHighest }]}
            >
              <Ionicons name="film-outline" size={20} color={colors.onSurfaceVariant} />
            </View>
          )}

          <View style={styles.textContainer}>
            <View style={styles.row}>
              {renderBadge(item.type, item.providerName)}
              <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                {time}
              </Text>
            </View>
            <Text
              variant="titleSmall"
              color={colors.onSurface}
              weight={item.isRead ? '500' : '700'}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
              {item.body}
            </Text>
          </View>

          {!item.isRead ? (
            <View
              style={[styles.unreadDot, { backgroundColor: colors.primary }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          ) : null}

          <IconButton
            icon="close"
            size={40}
            iconSize={20}
            onPress={() => handleDismissSingle(item)}
            accessibilityLabel={`Dismiss notification: ${item.title}`}
          />
        </View>
      </Touchable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.outlineVariant,
              paddingTop: Platform.OS === 'ios' ? spacing.lg : insets.top + spacing.md,
              paddingHorizontal: gutter,
            },
          ]}
        >
          <Text
            variant="headlineSmall"
            color={colors.onSurface}
            accessibilityRole="header"
            style={styles.flexShrink}
            numberOfLines={1}
          >
            What&apos;s new
          </Text>

          <View style={styles.headerRight}>
            {notifications.length > 0 ? (
              <Button
                label="Clear all"
                variant="text"
                size="small"
                onPress={handleClearAll}
                accessibilityHint="Removes every notification"
              />
            ) : null}
            <IconButton icon="close" onPress={onClose} accessibilityLabel="Close notifications" />
          </View>
        </View>

        {/* Content */}
        {loading && notifications.length === 0 ? (
          <View style={styles.center}>
            <Loading label="Loading notifications" size="large" />
          </View>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon="notifications-off-outline"
            title="You're all caught up"
            subtitle="We'll let you know when something you're tracking releases, or lands on a service you subscribe to."
          />
        ) : (
          <FlatList
            data={notifications}
            renderItem={renderItem}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  notificationCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  poster: {
    width: 48,
    height: 72,
    borderRadius: shape.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: shape.extraSmall,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: shape.full,
  },
});
