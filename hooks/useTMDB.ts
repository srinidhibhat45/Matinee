import { useState, useEffect, useCallback } from 'react';
import { tmdbService } from '../services/tmdb';

export function useTMDB() {
  const [apiKeySet, setApiKeySet] = useState(false);

  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = useCallback(async () => {
    const hasKey = await tmdbService.hasApiKey();
    setApiKeySet(hasKey);
  }, []);

  return {
    apiKeySet,
    checkApiKey,
    ...tmdbService,
  };
}

export function useTMDBData<T>(
  fetcher: () => Promise<T>,
  deps: any[] = []
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetcher();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
