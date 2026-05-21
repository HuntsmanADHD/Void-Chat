import { useCallback } from 'react';
import { useToast } from '@/components/ui/Toast';

/**
 * Thin fetch wrapper. Ephemeral identity model: no auth headers, the
 * surviving HTTP routes are public and rate-limited by IP server-side.
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
    const res = await fetch(endpoint, {
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

  return { get, post, put, delete: del };
}
