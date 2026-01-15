import { useState, useCallback, useEffect, useRef } from "react";

interface UsePanelDataOptions<T, D extends unknown[]> {
  fetcher: (...deps: D) => T;
  asyncFetcher?: (...deps: D) => Promise<T>;
  deps?: D;
  enabled?: boolean;
}

interface UsePanelDataResult<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
  refreshAsync: () => Promise<void>;
}

export function usePanelData<T, D extends unknown[] = []>({
  fetcher,
  asyncFetcher,
  deps = [] as unknown as D,
  enabled = true,
}: UsePanelDataOptions<T, D>): UsePanelDataResult<T> {
  // Initialize data and error together to avoid double fetcher call
  const [state, setState] = useState<{ data: T | null; error: string | null }>(() => {
    if (!enabled) return { data: null, error: null };
    try {
      return { data: fetcher(...deps), error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const [isLoading, setIsLoading] = useState(false);

  // Track if initial fetch happened
  const initialFetchDone = useRef(enabled);

  // Track previous deps for comparison
  const prevDepsRef = useRef<D>(deps);

  // Sync refresh
  const refresh = useCallback(() => {
    try {
      const result = fetcher(...deps);
      setState({ data: result, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [fetcher, deps]);

  // Async refresh
  const refreshAsync = useCallback(async () => {
    setIsLoading(true);
    try {
      let result: T;
      if (asyncFetcher) {
        result = await asyncFetcher(...deps);
      } else {
        // Fall back to sync fetcher wrapped in promise
        result = await Promise.resolve(fetcher(...deps));
      }
      setState({ data: result, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher, asyncFetcher, deps]);

  // Handle enabled change and deps change
  useEffect(() => {
    // Check if deps changed
    const depsChanged =
      deps.length !== prevDepsRef.current.length ||
      deps.some((dep, i) => dep !== prevDepsRef.current[i]);

    prevDepsRef.current = deps;

    if (enabled) {
      if (!initialFetchDone.current || depsChanged) {
        initialFetchDone.current = true;
        try {
          const result = fetcher(...deps);
          setState({ data: result, error: null });
        } catch (err) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    }
  }, [enabled, fetcher, ...deps]);

  return {
    data: state.data,
    error: state.error,
    isLoading,
    refresh,
    refreshAsync,
  };
}
