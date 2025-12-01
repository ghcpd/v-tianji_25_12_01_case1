# Enterprise Data Pipeline

A sophisticated TypeScript-based data processing pipeline with event-driven architecture, designed for high-throughput data transformation and API integration.

## Features

- **Event-Driven Architecture**: Publish-subscribe pattern for decoupled event handling
- **Robust API Client**: HTTP client with automatic retry logic and error handling
- **Batch Processing**: Efficient batch processing with configurable concurrency
- **Data Validation**: Comprehensive validation system with custom rules
- **Structured Logging**: Context-aware logging with multiple log levels
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## Architecture

### Core Modules

#### API Client (`src/core/api-client.ts`)
- HTTP client built on Axios
- Automatic retry for transient failures
- Request/response interceptors
- Comprehensive error handling

#### Data Processor (`src/core/data-processor.ts`)
- Batch processing with configurable batch sizes
- Concurrency control for parallel processing
- Retry logic with exponential backoff
- Event-driven status updates

#### Event Bus (`src/core/event-bus.ts`)
- Publish-subscribe pattern implementation
- Event filtering and prioritization
- Middleware support for event transformation
- Async event handling

#### Utilities
- **Logger** (`src/utils/logger.ts`): Structured logging with context
- **Validator** (`src/utils/validator.ts`): Rule-based data validation

## Installation

```bash
npm install
```

## Building

```bash
npm run build
```

## Running

```bash
npm start
```

For development with hot reload:

```bash
npm run dev
```

## Configuration

### Processor Configuration

```typescript
const config: ProcessorConfig = {
  batchSize: 10,           // Records per batch
  concurrency: 5,          // Parallel processing limit
  retryAttempts: 3,        // Maximum retry attempts
  timeout: 1000,           // Processing timeout in ms
  enableValidation: true   // Enable data validation
};
```

### API Client Configuration

```typescript
const apiClient = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  retryAttempts: 3,
  retryDelay: 1000,
  headers: {
    'Content-Type': 'application/json'
  }
});
```

## Usage Examples

### Processing Data Records

```typescript
import { DataProcessor } from './core/data-processor';
import { DataRecord } from './types';

const processor = new DataProcessor({
  batchSize: 10,
  concurrency: 5,
  retryAttempts: 3,
  timeout: 1000,
  enableValidation: true
});

const records: DataRecord[] = [
  {
    id: 'rec_001',
    timestamp: Date.now(),
    source: 'api',
    payload: { userId: 'user_123', action: 'login' }
  }
];

const results = await processor.processBatch(records);
```

### Event Handling

```typescript
import { eventBus } from './core/event-bus';

eventBus.subscribe('record.processing.completed', async (payload) => {
  console.log('Processing completed:', payload.data);
}, { priority: 10 });

await eventBus.publish('record.processing.completed', {
  recordId: 'rec_001',
  status: 'success'
});
```

### API Requests

```typescript
import { ApiClient } from './core/api-client';

const client = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  retryAttempts: 3,
  retryDelay: 1000
});

const response = await client.get('/users/123');
console.log(response.data);
```

## Type Definitions

All types are defined in `src/types/index.ts`:

- `DataRecord`: Input data record structure
- `ProcessingResult`: Processing outcome
- `EventPayload`: Event structure
- `ProcessorConfig`: Processor configuration
- `ApiResponse<T>`: API response wrapper

## Error Handling

The system provides comprehensive error handling:

- `ApiClientError`: API request failures
- `ProcessingError`: Data processing failures
- `ValidationError`: Data validation failures

All errors are logged with context and can be handled appropriately.

## Logging

The logger supports multiple log levels:

- `DEBUG`: Detailed debugging information
- `INFO`: General informational messages
- `WARN`: Warning messages
- `ERROR`: Error messages

Set log level:

```typescript
import { logger, LogLevel } from './utils/logger';

logger.setLevel(LogLevel.DEBUG);
```

## Testing

```bash
npm test
```

## License

MIT

