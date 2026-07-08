import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  Modal,
  SafeAreaView,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
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
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
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

  const renderBadge = (type: string, providerName: string | null) => {
    let text = 'Update';
    let badgeBg = isDark ? '#222225' : '#E5E5EA';
    let textColor = colors.secondary;

    if (type === 'new_release') {
      text = 'New Release';
      badgeBg = isDark ? 'rgba(236, 64, 122, 0.15)' : 'rgba(197, 47, 130, 0.12)';
      textColor = colors.accent;
    } else if (type === 'ott_available') {
      text = providerName ? `Now on ${providerName}` : 'OTT Release';
      badgeBg = isDark ? 'rgba(124, 77, 255, 0.15)' : 'rgba(101, 31, 255, 0.12)';
      textColor = isDark ? '#B388FF' : '#6200EA';
    } else if (type === 'trending') {
      text = 'Trending';
      badgeBg = isDark ? 'rgba(255, 145, 0, 0.15)' : 'rgba(255, 109, 0, 0.12)';
      textColor = isDark ? '#FF9100' : '#FF6D00';
    }

    return (
      <View style={[styles.badge, { backgroundColor: badgeBg }]}>
        <Text style={[styles.badgeText, { color: textColor }]}>{text}</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: InAppNotification }) => {
    const posterUrl = getImageUrl(item.posterPath, 'w92');

    return (
      <TouchableOpacity
        style={[
          styles.notificationCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderBottomWidth: 1,
          },
          !item.isRead && {
            backgroundColor: isDark ? 'rgba(236, 64, 122, 0.05)' : 'rgba(197, 47, 130, 0.03)',
          },
        ]}
        onPress={() => handleMarkAsRead(item)}
      >
        <View style={styles.cardContent}>
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              style={[styles.poster, { borderColor: colors.border }]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.posterPlaceholder, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Ionicons name="film-outline" size={20} color={colors.muted} />
            </View>
          )}

          <View style={styles.textContainer}>
            <View style={styles.row}>
              {renderBadge(item.type, item.providerName)}
              <Text style={[styles.timeText, { color: colors.muted }]}>
                {formatRelativeTime(item.createdAt)}
              </Text>
            </View>
            <Text
              style={[
                styles.titleText,
                { color: colors.text },
                !item.isRead && styles.unreadText,
              ]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text style={[styles.bodyText, { color: colors.secondary }]} numberOfLines={2}>
              {item.body}
            </Text>
          </View>

          {!item.isRead && (
            <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />
          )}

          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={(e) => {
              e.stopPropagation();
              handleDismissSingle(item);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === 'ios' ? 20 : insets.top + 12,
            },
          ]}
        >
          <Text style={[styles.headerTitle, { color: colors.text }]}>What's New</Text>

          <View style={styles.headerRight}>
            {notifications.length > 0 && (
              <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
                <Text style={[styles.clearBtnText, { color: colors.accent }]}>Clear All</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.card }]}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        {loading && notifications.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={[styles.iconContainer, { backgroundColor: colors.card }]}>
              <Ionicons name="notifications-off-outline" size={48} color={colors.muted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>You're all caught up</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              We'll notify you when new relevant movies/series release or become streaming on your subscription platforms.
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            renderItem={renderItem}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={styles.listContainer}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  clearBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContainer: {
    paddingBottom: 40,
  },
  notificationCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  poster: {
    width: 48,
    height: 72,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  posterPlaceholder: {
    width: 48,
    height: 72,
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timeText: {
    fontSize: 11,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 2,
  },
  unreadText: {
    fontWeight: '800',
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 64,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  dismissBtn: {
    padding: 8,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
