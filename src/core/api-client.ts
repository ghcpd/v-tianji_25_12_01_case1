/**
 * HTTP API Client
 * 
 * Provides a robust HTTP client for making API requests with
 * retry logic, error handling, and request/response interceptors.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';

export interface ApiClientConfig {
  baseURL: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  headers?: Record<string, string>;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiClient {
  private client: AxiosInstance;
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout,
      headers: config.headers || {}
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('API request initiated', {
          method: config.method,
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        logger.error('API request error', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('API response received', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      async (error: AxiosError) => {
        const config = error.config as AxiosRequestConfig & { _retryCount?: number };
        config._retryCount = config._retryCount || 0;

        if (this.shouldRetry(error, config._retryCount)) {
          config._retryCount += 1;
          await this.delay(this.config.retryDelay * config._retryCount);
          logger.info('Retrying API request', {
            attempt: config._retryCount,
            url: config.url
          });
          return this.client.request(config);
        }

        logger.error('API request failed', error, {
          status: error.response?.status,
          url: config.url
        });
        return Promise.reject(error);
      }
    );
  }

  private shouldRetry(error: AxiosError, retryCount: number): boolean {
    if (retryCount >= this.config.retryAttempts) {
      return false;
    }

    if (!error.response) {
      return true;
    }

    const status = error.response.status;
    return status >= 500 || status === 429;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.get<T>(url, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
        requestId: response.headers['x-request-id'] as string || 'unknown'
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new ApiClientError(
          `GET request failed: ${error.message}`,
          error.response?.status,
          error.response?.data
        );
      }
      throw error;
    }
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.post<T>(url, data, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
        requestId: response.headers['x-request-id'] as string || 'unknown'
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new ApiClientError(
          `POST request failed: ${error.message}`,
          error.response?.status,
          error.response?.data
        );
      }
      throw error;
    }
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.put<T>(url, data, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
        requestId: response.headers['x-request-id'] as string || 'unknown'
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new ApiClientError(
          `PUT request failed: ${error.message}`,
          error.response?.status,
          error.response?.data
        );
      }
      throw error;
    }
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.delete<T>(url, config);
      return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
        requestId: response.headers['x-request-id'] as string || 'unknown'
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new ApiClientError(
          `DELETE request failed: ${error.message}`,
          error.response?.status,
          error.response?.data
        );
      }
      throw error;
    }
  }
}

