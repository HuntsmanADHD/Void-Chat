import { useCallback, useMemo } from 'react';
import { useToast } from '@/components/ui/Toast';
import { apiUrl } from '@/lib/relayBase';

/**
 * Thin fetch wrapper. Relative paths get resolved against the bundled
 * relay (localhost:3001). When Phase 3 lands and CRUD moves to Tauri
 * commands, the call sites swap to `invoke()` and this hook goes away.
 */

export interface ApiError {
  message: string;
  statusCode: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

interface FetchConfig {
  showErrorToast?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<ApiResponse<T>> {
  try {
    // Endpoints starting with `/` resolve to the relay; absolute URLs pass through.
    const url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : apiUrl(endpoint);
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      return {
        success: false,
        error: { message: data.error || res.statusText, statusCode: res.status },
      };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: { message: err instanceof Error ? err.message : 'Network error', statusCode: 0 },
    };
  }
}

export function useApi() {
  const { error: showError } = useToast();

  const handleError = useCallback(
    (response: ApiResponse<unknown>, showToast: boolean) => {
      if (response.error && showToast) showError(response.error.message);
    },
    [showError]
  );

  const get = useCallback(
    async <T>(endpoint: string, config?: FetchConfig): Promise<ApiResponse<T>> => {
      const response = await request<T>('GET', endpoint, undefined, config?.signal);
      handleError(response, config?.showErrorToast !== false);
      return response;
    },
    [handleError]
  );

  const post = useCallback(
    async <T>(endpoint: string, body?: unknown, config?: FetchConfig): Promise<ApiResponse<T>> => {
      const response = await request<T>('POST', endpoint, body, config?.signal);
      handleError(response, config?.showErrorToast !== false);
      return response;
    },
    [handleError]
  );

  const put = useCallback(
    async <T>(endpoint: string, body?: unknown, config?: FetchConfig): Promise<ApiResponse<T>> => {
      const response = await request<T>('PUT', endpoint, body, config?.signal);
      handleError(response, config?.showErrorToast !== false);
      return response;
    },
    [handleError]
  );

  const del = useCallback(
    async <T>(endpoint: string, config?: FetchConfig): Promise<ApiResponse<T>> => {
      const response = await request<T>('DELETE', endpoint, undefined, config?.signal);
      handleError(response, config?.showErrorToast !== false);
      return response;
    },
    [handleError]
  );

  // Memo the returned object so consumers can safely include `api` in
  // useEffect deps. Without this the literal `{ get, post, put, delete }`
  // is a fresh reference every render → effects re-fire every render →
  // any effect that calls api.get(...) loops forever.
  return useMemo(() => ({ get, post, put, delete: del }), [get, post, put, del]);
}
