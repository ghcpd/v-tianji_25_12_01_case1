/**
 * Data validation utilities
 * 
 * Provides validation functions and rule-based validation system
 * for data records and API responses.
 */

import { ValidationRule, DataRecord } from '../types';
import { logger } from './logger';

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class Validator {
  private rules: ValidationRule[] = [];

  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  addRules(rules: ValidationRule[]): void {
    this.rules.push(...rules);
  }

  validate(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const rule of this.rules) {
      const value = data[rule.field];
      if (!rule.validator(value)) {
        errors.push(`${rule.field}: ${rule.errorMessage}`);
        logger.warn('Validation failed', { field: rule.field, value });
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  clearRules(): void {
    this.rules = [];
  }
}

export function validateDataRecord(record: DataRecord): boolean {
  if (!record.id || typeof record.id !== 'string') {
    throw new ValidationError('Record ID is required and must be a string', 'id', record.id);
  }

  if (!record.timestamp || typeof record.timestamp !== 'number') {
    throw new ValidationError('Timestamp is required and must be a number', 'timestamp', record.timestamp);
  }

  if (!record.payload || typeof record.payload !== 'object') {
    throw new ValidationError('Payload is required and must be an object', 'payload', record.payload);
  }

  if (!record.source || typeof record.source !== 'string') {
    throw new ValidationError('Source is required and must be a string', 'source', record.source);
  }

  return true;
}

export function createDefaultValidator(): Validator {
  const validator = new Validator();
  
  validator.addRules([
    {
      field: 'id',
      validator: (value) => typeof value === 'string' && value.length > 0,
      errorMessage: 'ID must be a non-empty string'
    },
    {
      field: 'timestamp',
      validator: (value) => typeof value === 'number' && value > 0,
      errorMessage: 'Timestamp must be a positive number'
    }
  ]);

  return validator;
}

