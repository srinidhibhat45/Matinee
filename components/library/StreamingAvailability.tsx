import React, { useEffect, useState } from 'react';
import { View, Linking, Image } from 'react-native';
import { Text, Button } from '../m3';
import { getPreference } from '../../services/database';
import { getImageUrl } from '../../services/tmdb';
import { useTheme } from '../../context/ThemeContext';
import { useNotice } from '../../context/NoticeContext';
import type { WatchProviderResult } from '../../types';
export default function StreamingAvailability({
  providers
}: {
  providers: WatchProviderResult | null;
}) {
  const {
    colors
  } = useTheme();
  const notice = useNotice();
  const [country, setCountry] = useState('IN');
  const [subscriptions, setSubscriptions] = useState<number[]>([]);
  useEffect(() => {
    getPreference('PREF_USER_COUNTRY').then(c => setCountry(c || 'IN'));
    getPreference('PREF_OTT_PROVIDERS').then(v => setSubscriptions((v ?? '').split(',').map(Number)));
  }, []);
  const groups = [{
    label: 'Included with a subscription',
    items: providers?.flatrate ?? []
  }, {
    label: 'Rent',
    items: providers?.rent ?? []
  }, {
    label: 'Buy',
    items: providers?.buy ?? []
  }];
  return <View style={{
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 12
  }}>
    <Text variant="titleLarge" accessibilityRole="header">Where to watch · {country}</Text>
    {!groups.some(g => g.items.length) && <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Availability is unknown in your selected country. Other countries’ listings are never substituted.</Text>}
    {groups.filter(g => g.items.length).map(g => <View key={g.label} style={{
      gap: 8
    }}>
      <Text variant="labelLarge" color={colors.onSurfaceVariant}>{g.label}</Text>
      <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12
      }}>{g.items.map(p => <View key={p.provider_id} style={{
          flexDirection: 'row',
          gap: 8,
          alignItems: 'center',
          maxWidth: '100%'
        }}>
        {!!p.logo_path && <Image source={{
            uri: getImageUrl(p.logo_path, 'w92') ?? ''
          }} style={{
            height: 32,
            width: 32,
            borderRadius: 6
          }} accessible={false} />}
        <Text variant="bodyMedium" style={{
            flexShrink: 1
          }}>{p.provider_name}{g.label.startsWith('Included') && subscriptions.includes(p.provider_id) ? ' · Your subscription' : ''}</Text>
      </View>)}</View>
    </View>)}
    {!!providers?.link && <Button label="Check provider options" icon="open-outline" variant="outlined" onPress={() => Linking.openURL(providers.link!).catch(() => notice({
      message: 'Could not open provider options.'
    }))} accessibilityHint="Opens the regional streaming availability page" />}
    <Text variant="bodySmall" color={colors.onSurfaceVariant}>Availability can change. Provider data supplied by TMDB / JustWatch.</Text>
  </View>;
}
