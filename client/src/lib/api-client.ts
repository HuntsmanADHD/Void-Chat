/**
 * API Client for Void Chat
 * HTTP client that communicates with the standalone Express server
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    statusCode?: number;
  };
}

export interface RequestConfig {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

class ApiClient {
  private baseUrl: string;
  private authHeaders: Record<string, string> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAuthHeaders(headers: Record<string, string> | null) {
    this.authHeaders = headers;
  }

  private getHeaders(config?: RequestConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.authHeaders,
      ...config?.headers,
    };
    return headers;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(config),
        body: body ? JSON.stringify(body) : undefined,
        signal: config?.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            message: data.error || `Request failed with status ${response.status}`,
            code: data.code,
            statusCode: response.status,
          },
        };
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          success: false,
          error: { message: 'Request aborted', code: 'ABORTED', statusCode: 0 },
        };
      }

      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Network error',
          code: 'NETWORK_ERROR',
          statusCode: 0,
        },
      };
    }
  }

  async get<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>('GET', endpoint, undefined, config);
  }

  async post<T>(endpoint: string, body?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>('POST', endpoint, body, config);
  }

  async put<T>(endpoint: string, body?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', endpoint, body, config);
  }

  async delete<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', endpoint, undefined, config);
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
