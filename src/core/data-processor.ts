/**
 * Data Processing Engine
 * 
 * Handles batch processing of data records with concurrency control,
 * retry logic, and comprehensive error handling.
 */

import {
  DataRecord,
  ProcessingResult,
  ProcessingContext,
  ProcessingStatus,
  ProcessorConfig
} from '../types';
import { logger } from '../utils/logger';
import { validateDataRecord, ValidationError } from '../utils/validator';
import { eventBus } from './event-bus';

export class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly recordId: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

export class DataProcessor {
  private config: ProcessorConfig;
  private processingQueue: Map<string, ProcessingContext> = new Map();

  constructor(config: ProcessorConfig) {
    this.config = config;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    eventBus.subscribe('record.processing.started', async (payload) => {
      logger.info('Record processing started', payload.data as Record<string, unknown>);
    });

    eventBus.subscribe('record.processing.completed', async (payload) => {
      logger.info('Record processing completed', payload.data as Record<string, unknown>);
    });

    eventBus.subscribe('record.processing.failed', async (payload) => {
      logger.error('Record processing failed', undefined, payload.data as Record<string, unknown>);
    });
  }

  /**
   * Process a single data record
   */
  async processRecord(record: DataRecord): Promise<ProcessingResult> {
    const context: ProcessingContext = {
      recordId: record.id,
      status: ProcessingStatus.PROCESSING,
      attempts: 0,
      startedAt: Date.now()
    };

    this.processingQueue.set(record.id, context);

    try {
      await eventBus.publish('record.processing.started', {
        recordId: record.id,
        source: record.source
      }, record.id);

      if (this.config.enableValidation) {
        validateDataRecord(record);
      }

      const transformedData = await this.transformRecord(record);
      context.status = ProcessingStatus.COMPLETED;
      context.completedAt = Date.now();

      await eventBus.publish('record.processing.completed', {
        recordId: record.id,
        transformedData
      }, record.id);

      this.processingQueue.delete(record.id);

      return {
        success: true,
        recordId: record.id,
        processedAt: context.completedAt,
        transformedData
      };
    } catch (error) {
      context.attempts += 1;
      context.error = error as Error;

      if (context.attempts < this.config.retryAttempts) {
        context.status = ProcessingStatus.RETRYING;
        logger.warn('Retrying record processing', {
          recordId: record.id,
          attempt: context.attempts
        });

        await this.delay(this.config.timeout);
        return this.processRecord(record);
      }

      context.status = ProcessingStatus.FAILED;
      context.completedAt = Date.now();

      await eventBus.publish('record.processing.failed', {
        recordId: record.id,
        error: error instanceof Error ? error.message : String(error),
        attempts: context.attempts
      }, record.id);

      this.processingQueue.delete(record.id);

      const errorMessage = error instanceof ValidationError
        ? `Validation failed: ${error.message}`
        : error instanceof Error
        ? error.message
        : String(error);

      return {
        success: false,
        recordId: record.id,
        processedAt: context.completedAt,
        errors: [errorMessage]
      };
    }
  }

  /**
   * Process multiple records in batches with concurrency control
   */
  async processBatch(records: DataRecord[]): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];
    const batches = this.createBatches(records, this.config.batchSize);

    logger.info('Starting batch processing', {
      totalRecords: records.length,
      batchSize: this.config.batchSize,
      numberOfBatches: batches.length
    });

    for (const batch of batches) {
      const batchResults = await this.processBatchWithConcurrency(batch);
      results.push(...batchResults);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    logger.info('Batch processing completed', {
      totalRecords: records.length,
      successCount,
      failureCount
    });

    return results;
  }

  private async processBatchWithConcurrency(
    records: DataRecord[]
  ): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];
    const executing: Promise<void>[] = [];

    for (const record of records) {
      const promise = this.processRecord(record).then(result => {
        results.push(result);
      });

      executing.push(promise);

      if (executing.length >= this.config.concurrency) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(p => p === promise), 1);
      }
    }

    await Promise.all(executing);
    return results;
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async transformRecord(record: DataRecord): Promise<Record<string, unknown>> {
    await this.delay(10);

    return {
      id: record.id,
      processedAt: Date.now(),
      source: record.source,
      data: {
        ...record.payload,
        enriched: true,
        version: '1.0'
      },
      metadata: {
        ...record.metadata,
        processor: 'data-processor-v1'
      }
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get processing status for a record
   */
  getProcessingStatus(recordId: string): ProcessingContext | undefined {
    return this.processingQueue.get(recordId);
  }

  /**
   * Get all active processing contexts
   */
  getActiveProcesses(): ProcessingContext[] {
    return Array.from(this.processingQueue.values());
  }
}

