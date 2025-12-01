/**
 * Main Application Entry Point
 * 
 * Demonstrates the integration of all core modules:
 * - API Client for external service communication
 * - Data Processor for batch data transformation
 * - Event Bus for decoupled event handling
 * - Validation utilities for data integrity
 */

import { ApiClient } from './core/api-client';
import { DataProcessor } from './core/data-processor';
import { eventBus } from './core/event-bus';
import { DataRecord, ProcessorConfig } from './types';
import { logger } from './utils/logger';
import { LogLevel } from './utils/logger';

async function main(): Promise<void> {
  logger.setLevel(LogLevel.INFO);
  logger.info('Application starting');

  const apiClient = new ApiClient({
    baseURL: 'https://api.example.com',
    timeout: 5000,
    retryAttempts: 3,
    retryDelay: 1000,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'EnterpriseDataPipeline/1.0'
    }
  });

  const processorConfig: ProcessorConfig = {
    batchSize: 10,
    concurrency: 5,
    retryAttempts: 3,
    timeout: 1000,
    enableValidation: true
  };

  const dataProcessor = new DataProcessor(processorConfig);

  eventBus.subscribe('record.processing.completed', async (payload) => {
    logger.info('Processing completion event received', {
      correlationId: payload.correlationId,
      recordId: (payload.data as { recordId: string }).recordId
    });
  }, { priority: 10 });

  eventBus.use(async (payload) => {
    logger.debug('Event middleware: adding request metadata', {
      eventType: payload.type
    });
    return {
      ...payload,
      data: {
        ...payload.data as Record<string, unknown>,
        middlewareProcessed: true
      }
    };
  });

  const sampleRecords: DataRecord[] = [
    {
      id: 'rec_001',
      timestamp: Date.now(),
      source: 'api',
      payload: {
        userId: 'user_123',
        action: 'login',
        ip: '192.168.1.1'
      },
      metadata: {
        version: '1.0',
        environment: 'production'
      }
    },
    {
      id: 'rec_002',
      timestamp: Date.now(),
      source: 'webhook',
      payload: {
        event: 'purchase',
        amount: 99.99,
        currency: 'USD'
      },
      metadata: {
        version: '1.0'
      }
    },
    {
      id: 'rec_003',
      timestamp: Date.now(),
      source: 'batch',
      payload: {
        operation: 'sync',
        recordsCount: 1000
      }
    }
  ];

  try {
    logger.info('Starting data processing pipeline');
    const results = await dataProcessor.processBatch(sampleRecords);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    logger.info('Pipeline execution completed', {
      totalRecords: sampleRecords.length,
      successCount,
      failureCount
    });

    results.forEach(result => {
      if (result.success) {
        logger.debug('Record processed successfully', {
          recordId: result.recordId,
          processedAt: result.processedAt
        });
      } else {
        logger.warn('Record processing failed', {
          recordId: result.recordId,
          errors: result.errors
        });
      }
    });

    const activeProcesses = dataProcessor.getActiveProcesses();
    if (activeProcesses.length > 0) {
      logger.warn('Some processes are still active', {
        count: activeProcesses.length
      });
    }

  } catch (error) {
    logger.error('Fatal error in pipeline execution', error as Error);
    process.exit(1);
  }

  logger.info('Application shutting down');
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in main', error);
    process.exit(1);
  });
}

export { ApiClient } from './core/api-client';
export { DataProcessor } from './core/data-processor';
export { eventBus } from './core/event-bus';
export * from './types';
export * from './utils/logger';
export * from './utils/validator';

