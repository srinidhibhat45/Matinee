import { useState, useCallback } from 'react';
import { recommendationService } from '../services/recommendations';
import { RecommendedItem, TMDBMediaItem, MediaType } from '../types';

export function useRecommendations() {
  const [recommendations, setRecommendations] = useState<RecommendedItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecommendations = useCallback(async (limit?: number) => {
    setLoading(true);
    try {
      const recs = await recommendationService.getPersonalizedRecommendations(limit);
      setRecommendations(recs);
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const getSimilar = useCallback(async (tmdbId: number, mediaType: MediaType) => {
    try {
      return await recommendationService.getSimilarToWatched(tmdbId, mediaType);
    } catch {
      return [];
    }
  }, []);

  return { recommendations, loading, fetchRecommendations, getSimilar };
}
