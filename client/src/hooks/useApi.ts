import { useCallback, useEffect, useRef } from 'react';
import { apiClient, type ApiResponse, type RequestConfig } from '@/lib/api-client';
import { useAuth } from './useAuth';
import { useToast } from '@/components/ui/Toast';

export function useApi() {
  const { session, isAuthenticated } = useAuth();
  const { error: showError } = useToast();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (session && isAuthenticated) {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('voidchat_auth_token') : null;
      apiClient.setAuthHeaders({
        'Authorization': token ? `Bearer ${token}` : '',
        'x-public-id': session.publicId,
        'x-public-key': session.publicKey,
      });
    } else {
      apiClient.setAuthHeaders(null);
    }
  }, [session, isAuthenticated]);

  const handleError = useCallback(
    (error: ApiResponse<unknown>['error'], showToast: boolean = true) => {
      if (!error) return;

      if (showToast && isMountedRef.current) {
        showError(error.message);
      }

      if (error.statusCode === 401) {
        console.warn('Session expired, user needs to re-authenticate');
      }
    },
    [showError]
  );

  const get = useCallback(
    async <T>(
      endpoint: string,
      config?: RequestConfig & { showErrorToast?: boolean }
    ): Promise<ApiResponse<T>> => {
      const { showErrorToast = true, ...requestConfig } = config || {};
      const response = await apiClient.get<T>(endpoint, requestConfig);

      if (!response.success) {
        handleError(response.error, showErrorToast);
      }

      return response;
    },
    [handleError]
  );

  const post = useCallback(
    async <T>(
      endpoint: string,
      body?: unknown,
      config?: RequestConfig & { showErrorToast?: boolean }
    ): Promise<ApiResponse<T>> => {
      const { showErrorToast = true, ...requestConfig } = config || {};
      const response = await apiClient.post<T>(endpoint, body, requestConfig);

      if (!response.success) {
        handleError(response.error, showErrorToast);
      }

      return response;
    },
    [handleError]
  );

  const put = useCallback(
    async <T>(
      endpoint: string,
      body?: unknown,
      config?: RequestConfig & { showErrorToast?: boolean }
    ): Promise<ApiResponse<T>> => {
      const { showErrorToast = true, ...requestConfig } = config || {};
      const response = await apiClient.put<T>(endpoint, body, requestConfig);

      if (!response.success) {
        handleError(response.error, showErrorToast);
      }

      return response;
    },
    [handleError]
  );

  const del = useCallback(
    async <T>(
      endpoint: string,
      config?: RequestConfig & { showErrorToast?: boolean }
    ): Promise<ApiResponse<T>> => {
      const { showErrorToast = true, ...requestConfig } = config || {};
      const response = await apiClient.delete<T>(endpoint, requestConfig);

      if (!response.success) {
        handleError(response.error, showErrorToast);
      }

      return response;
    },
    [handleError]
  );

  return {
    get,
    post,
    put,
    delete: del,
  };
}
