/**
 * Core type definitions for the data pipeline system
 * 
 * This module contains all shared type definitions used across
 * the application. Types are organized by domain area.
 */

export interface DataRecord {
  id: string;
  timestamp: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, string>;
  source: string;
}

export interface ProcessingResult {
  success: boolean;
  recordId: string;
  processedAt: number;
  transformedData?: Record<string, unknown>;
  errors?: string[];
  warnings?: string[];
}

export interface EventPayload {
  type: string;
  data: unknown;
  correlationId?: string;
  timestamp: number;
}

export interface EventHandler {
  (payload: EventPayload): Promise<void> | void;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
  requestId: string;
}

export interface ProcessorConfig {
  batchSize: number;
  concurrency: number;
  retryAttempts: number;
  timeout: number;
  enableValidation: boolean;
}

export interface ValidationRule {
  field: string;
  validator: (value: unknown) => boolean;
  errorMessage: string;
}

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

export interface ProcessingContext {
  recordId: string;
  status: ProcessingStatus;
  attempts: number;
  startedAt: number;
  completedAt?: number;
  error?: Error;
}

