import type { TMDBMediaDetails } from '../types';
export interface ViewingLink {
  url: string;
  label: string;
  hint: string;
}

/** Use supplied links only. A streaming listing never promises direct playback. */
export function getViewingLink(item: Pick<TMDBMediaDetails, 'title' | 'watchProviders' | 'videos'>): ViewingLink | null {
  const link = item.watchProviders?.link;
  if (link) {
    try {
      const url = new URL(link);
      if (url.protocol === 'https:' && (url.hostname === 'themoviedb.org' || url.hostname.endsWith('.themoviedb.org'))) {
        return {
          url: url.href,
          label: `Where to watch ${item.title}`,
          hint: 'Opens streaming options in your selected country'
        };
      }
    } catch {/* Missing or malformed links are not actionable. */}
  }
  const trailer = item.videos?.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ?? item.videos?.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  if (!trailer?.key) return null;
  return {
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`,
    label: `Watch the trailer for ${item.title}`,
    hint: 'Opens the trailer on YouTube'
  };
}
