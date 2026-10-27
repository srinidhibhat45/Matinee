import { recommendationService } from './recommendations';
import { tmdbService, limitConcurrency } from './tmdb';
import { getAllItems, getPreference } from './database';
import type { RecommendedItem, TMDBMediaDetails } from '../types';
import { localDay } from './libraryActivity';
export interface TonightPreferences {
  mood: 'any' | 'funny' | 'chill' | 'intense' | 'thoughtful';
  maxMinutes: number | null;
  language: string;
  subscriptionsOnly: boolean;
}
const MOODS: Record<TonightPreferences['mood'], number[]> = {
  any: [],
  funny: [35],
  chill: [35, 10751, 16],
  intense: [53, 28, 80, 9648, 10759],
  thoughtful: [18, 878, 99, 10765]
};
export function fitsTonight(item: TMDBMediaDetails, prefs: TonightPreferences, providerIds: number[]): boolean {
  return !!item.releaseDate && item.releaseDate <= localDay() && (prefs.language === 'all' || item.originalLanguage === prefs.language) && (!prefs.maxMinutes || !!item.runtime && item.runtime <= prefs.maxMinutes) && (!prefs.subscriptionsOnly || !!item.watchProviders?.flatrate?.some(p => providerIds.includes(p.provider_id)));
}
export async function pickTonight(prefs: TonightPreferences): Promise<RecommendedItem[]> {
  const [candidates, library, providerPref] = await Promise.all([recommendationService.getPersonalizedRecommendations(60), getAllItems(), getPreference('PREF_OTT_PROVIDERS')]);
  const excluded = new Set(library.filter(i => i.status === 'watched' || i.status === 'not_interested').map(i => `${i.mediaType}:${i.tmdbId}`));
  const genres = MOODS[prefs.mood];
  const shortlist = candidates.filter(i => !excluded.has(`${i.mediaType}:${i.id}`) && (prefs.language === 'all' || i.originalLanguage === prefs.language) && (!genres.length || i.genreIds.some(g => genres.includes(g)))).slice(0, 24);
  const providerIds = (providerPref ?? '').split(',').map(Number).filter(n => n > 0);
  if (prefs.subscriptionsOnly && !providerIds.length) throw new Error('Choose your streaming subscriptions in Library → Settings first.');
  const enriched = await limitConcurrency(shortlist, 4, async item => {
    try {
      const details = await tmdbService.getDetails(item.id, item.mediaType);
      if (!details || !fitsTonight(details, prefs, providerIds)) return null;
      return {
        ...item,
        runtime: details.runtime,
        watchProviders: details.watchProviders,
        reason: [item.reason, details.runtime ? `${details.runtime} min${item.mediaType === 'tv' ? ' per episode' : ''}` : null, prefs.subscriptionsOnly ? 'Included with your subscriptions' : null].filter(Boolean).join(' · ')
      };
    } catch {
      return null;
    }
  });
  return enriched.filter((i): i is NonNullable<typeof i> => !!i).slice(0, 3);
}
