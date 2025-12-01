/**
 * Unit tests for DataProcessor
 * 
 * Demonstrates testing patterns for the data processing module
 */

import { DataProcessor } from '../core/data-processor';
import { DataRecord, ProcessorConfig } from '../types';
import { ValidationError } from '../utils/validator';

describe('DataProcessor', () => {
  let processor: DataProcessor;
  let config: ProcessorConfig;

  beforeEach(() => {
    config = {
      batchSize: 5,
      concurrency: 2,
      retryAttempts: 2,
      timeout: 100,
      enableValidation: true
    };
    processor = new DataProcessor(config);
  });

  describe('processRecord', () => {
    it('should successfully process a valid record', async () => {
      const record: DataRecord = {
        id: 'test_001',
        timestamp: Date.now(),
        source: 'test',
        payload: { test: 'data' }
      };

      const result = await processor.processRecord(record);

      expect(result.success).toBe(true);
      expect(result.recordId).toBe(record.id);
      expect(result.transformedData).toBeDefined();
    });

    it('should fail processing invalid record', async () => {
      const invalidRecord = {
        id: '',
        timestamp: -1,
        source: '',
        payload: null
      } as unknown as DataRecord;

      const result = await processor.processRecord(invalidRecord);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('processBatch', () => {
    it('should process multiple records in batches', async () => {
      const records: DataRecord[] = Array.from({ length: 12 }, (_, i) => ({
        id: `rec_${i}`,
        timestamp: Date.now(),
        source: 'test',
        payload: { index: i }
      }));

      const results = await processor.processBatch(records);

      expect(results.length).toBe(12);
      expect(results.every(r => r.recordId)).toBe(true);
    });

    it('should handle empty batch', async () => {
      const results = await processor.processBatch([]);
      expect(results.length).toBe(0);
    });
  });

  describe('getProcessingStatus', () => {
    it('should return undefined for non-existent record', () => {
      const status = processor.getProcessingStatus('non_existent');
      expect(status).toBeUndefined();
    });
  });
});

