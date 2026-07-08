/**
 * TMDB Watch Provider IDs → Display names for major OTT platforms.
 * These IDs are from TMDB's watch provider API.
 */
export interface OttProvider {
  id: number;
  name: string;
}

export const OTT_PROVIDERS: OttProvider[] = [
  { id: 8, name: 'Netflix' },
  { id: 9, name: 'Amazon Prime Video' },
  { id: 337, name: 'Disney+ Hotstar' },
  { id: 2, name: 'Apple TV+' },
  { id: 384, name: 'HBO Max' },
  { id: 15, name: 'Hulu' },
  { id: 386, name: 'Peacock' },
  { id: 531, name: 'Paramount+' },
  { id: 220, name: 'JioCinema' },
  { id: 232, name: 'Zee5' },
  { id: 237, name: 'SonyLIV' },
  { id: 11, name: 'Mubi' },
  { id: 283, name: 'Crunchyroll' },
  { id: 350, name: 'Apple TV' },
  { id: 1899, name: 'Max' },
];

/**
 * Country list with ISO 3166-1 codes and flag emojis.
 */
export interface Country {
  code: string;
  name: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
];
