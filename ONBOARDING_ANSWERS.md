# Onboarding Assessment: Enterprise Data Pipeline

## Question 1: Architecture Overview
**Question:** "What is the main purpose of this project and how is it architected?"

### Answer:
**Main Purpose:** This is an Enterprise Data Pipeline - a sophisticated TypeScript-based system for high-throughput data processing with event-driven architecture. It transforms, validates, and processes data records while integrating with external APIs.

**Architecture Overview:**
- **Event-Driven Design**: Uses publish-subscribe pattern for decoupled component communication
- **Modular Structure**: Clear separation of concerns with dedicated modules for API communication, data processing, event handling, validation, and logging
- **Pipeline Pattern**: Data flows through distinct stages - validation → transformation → event publishing
- **Concurrent Processing**: Supports batch processing with configurable concurrency control

**Core Components:**
1. **API Client** - HTTP communication with retry logic
2. **Data Processor** - Batch processing engine with concurrency and error handling
3. **Event Bus** - Pub-sub system for event distribution
4. **Validator** - Rule-based data validation
5. **Logger** - Structured logging with context support

---

## Question 2: Module Interactions
**Question:** "How does the DataProcessor interact with the EventBus? Trace the code flow."

### Answer:
**Module Dependency:** DataProcessor depends on EventBus for communication about processing status changes.

**Code Flow Trace:**

1. **Initialization Phase** (DataProcessor constructor):
   ```
   DataProcessor.constructor()
   → calls setupEventHandlers()
   → subscribes to 3 internal events:
      - 'record.processing.started'
      - 'record.processing.completed'
      - 'record.processing.failed'
   ```

2. **Processing Phase** (processRecord method):
   ```
   processRecord(record)
   → Updates context to PROCESSING
   → eventBus.publish('record.processing.started', {...}, correlationId)
   → Validates record (if enabled)
   → Transforms record via transformRecord()
   → Updates context to COMPLETED
   → eventBus.publish('record.processing.completed', {...}, correlationId)
   → Returns ProcessingResult
   ```

3. **Error/Retry Phase**:
   ```
   If validation/transformation fails:
   → Increments attempts counter
   → If attempts < retryAttempts:
      → Updates context to RETRYING
      → Delays for config.timeout ms
      → Recursively calls processRecord()
   → If max retries exceeded:
      → Updates context to FAILED
      → eventBus.publish('record.processing.failed', {...}, correlationId)
      → Returns failure result
   ```

4. **Event Publishing Details**:
   - Each publish includes correlationId for request tracking
   - EventBus applies middleware before dispatch
   - Handlers execute asynchronously via Promise.allSettled()
   - Errors in handlers are logged but don't block processing

**Data Flow Example:**
```
Input: DataRecord → processRecord() 
  → publish('started') 
  → validate() 
  → transformRecord() 
  → publish('completed') 
  → Output: ProcessingResult
```

---

## Question 3: Implementation Details
**Question:** "How does the retry mechanism work in ApiClient? Where is it implemented and what are the retry conditions?"

### Answer:
**Implementation Location:** `src/core/api-client.ts` in the response interceptor

**Retry Mechanism:**

1. **Configuration** (ApiClientConfig):
   ```typescript
   retryAttempts: number    // Maximum retry count
   retryDelay: number       // Base delay in milliseconds
   ```

2. **Retry Decision Logic** (`shouldRetry` method):
   ```typescript
   - Returns false if retryCount >= config.retryAttempts (max retries reached)
   - Returns true if error has no response (network/timeout error)
   - Returns true if response status is 5xx or 429 (Too Many Requests)
   - Returns false for all other cases (4xx client errors)
   ```

3. **Retry Execution** (response interceptor):
   ```
   When error occurs:
   → Check shouldRetry(error, retryCount)
   → If true:
      → Increment _retryCount on request config
      → Wait: delay(retryDelay * retryCount) [exponential backoff]
      → Log retry attempt with details
      → Re-execute: return this.client.request(config)
   → If false:
      → Log error
      → Throw ApiClientError with details
   ```

4. **Exponential Backoff Formula:**
   ```
   Delay = retryDelay × retryCount
   - Attempt 1: retryDelay × 1
   - Attempt 2: retryDelay × 2
   - Attempt 3: retryDelay × 3
   ```

5. **Error Wrapping:**
   - Catches AxiosError and wraps in custom ApiClientError
   - Preserves original status code and response data
   - Provides descriptive messages (GET/POST/PUT/DELETE request failed)

**Example Scenario:**
```
Config: retryDelay=1000, retryAttempts=3
Request fails with 503 status:
  → Attempt 1 failed, retry count=0
  → Wait 1000ms
  → Attempt 2 failed, retry count=1
  → Wait 2000ms
  → Attempt 3 failed, retry count=2
  → Wait 3000ms
  → Max retries reached → throw ApiClientError
```

---

## Question 4: Error Handling
**Question:** "What happens when a data record fails validation? Trace the error path through the system."

### Answer:
**Validation Error Path:**

1. **Validation Trigger** (in DataProcessor.processRecord):
   ```
   if (this.config.enableValidation) {
     validateDataRecord(record)  // Throws ValidationError if invalid
   }
   ```

2. **ValidationError Details** (in validator.ts):
   ```typescript
   export class ValidationError extends Error {
     constructor(message, field, value)
     // Example: ValidationError("Record ID is required", "id", null)
   }
   ```

3. **Validation Checks** (validateDataRecord function):
   ```
   - id: must be non-empty string → throws ValidationError('id')
   - timestamp: must be positive number → throws ValidationError('timestamp')
   - payload: must be non-null object → throws ValidationError('payload')
   - source: must be non-empty string → throws ValidationError('source')
   ```

4. **Error Handling in processRecord**:
   ```typescript
   catch (error) {
     context.attempts += 1
     context.error = error
     
     if (context.attempts < this.config.retryAttempts) {
       → status = RETRYING
       → log warning
       → delay(timeout)
       → retry by calling processRecord() recursively
     } else {
       → status = FAILED
       → context.completedAt = now
       → eventBus.publish('record.processing.failed', {...})
       → processingQueue.delete(recordId)
       → return ProcessingResult with success=false
     }
   }
   ```

5. **Error Message Formatting**:
   ```typescript
   if (error instanceof ValidationError) {
     errorMessage = `Validation failed: ${error.message}`
   } else if (error instanceof Error) {
     errorMessage = error.message
   }
   return { success: false, recordId, errors: [errorMessage] }
   ```

6. **Event Publishing**:
   ```
   eventBus.publish('record.processing.failed', {
     recordId,
     error: error.message,
     attempts: context.attempts
   }, correlationId)
   ```

7. **Logging**:
   - Setup handler logs: `logger.error('Record processing failed', ...)`
   - Processing code logs: `logger.warn('Retrying record processing', ...)`

**Complete Error Flow Example:**
```
DataRecord with id='' (invalid)
  → processRecord() called
  → config.enableValidation=true
  → validateDataRecord(record)
  → throws ValidationError('Record ID is required', 'id', '')
  → caught in catch block
  → attempts++
  → if attempts < retryAttempts:
      → Retry same record
  → else:
      → publish('record.processing.failed')
      → return { success: false, errors: ['Validation failed: ...'] }
```

---

## Question 5: Configuration
**Question:** "How can I customize the batch processing behavior? What configuration options are available?"

### Answer:
**ProcessorConfig Interface:**

```typescript
interface ProcessorConfig {
  batchSize: number          // Records per batch
  concurrency: number        // Parallel processing limit
  retryAttempts: number      // Max retry attempts per record
  timeout: number            // Delay between retries (ms)
  enableValidation: boolean  // Enable/disable validation
}
```

**Configuration Options Explained:**

1. **batchSize** (Default: 10)
   - Purpose: Split records into chunks for processing
   - Range: 1-∞
   - Impact: Larger batches = fewer iterations but higher memory usage
   - Example: 100 records with batchSize=10 = 10 batches of 10 records

2. **concurrency** (Default: 5)
   - Purpose: Control parallel processing within each batch
   - Range: 1-∞ (typically 1-50)
   - Impact: Higher concurrency = faster processing but more resource usage
   - Mechanism: Uses Promise.race() to limit simultaneous promises

3. **retryAttempts** (Default: 3)
   - Purpose: How many times to retry failed records
   - Range: 1-∞
   - Impact: More attempts = better resilience but slower failure confirmation
   - Applies to: Validation errors and transformation errors

4. **timeout** (Default: 1000)
   - Purpose: Delay between retry attempts (milliseconds)
   - Range: 0-∞
   - Impact: Longer timeouts give transient failures more recovery time
   - Applies to: DataProcessor retry delays (not exponential backoff)

5. **enableValidation** (Default: true)
   - Purpose: Enable/disable record validation before processing
   - Values: true | false
   - Impact: true = safer but slower; false = faster but riskier

**Configuration Example:**

```typescript
// Conservative (slow but reliable)
const conservativeConfig: ProcessorConfig = {
  batchSize: 5,
  concurrency: 2,
  retryAttempts: 5,
  timeout: 2000,
  enableValidation: true
};

// Aggressive (fast but less reliable)
const aggressiveConfig: ProcessorConfig = {
  batchSize: 50,
  concurrency: 20,
  retryAttempts: 1,
  timeout: 100,
  enableValidation: false
};

// Balanced (recommended)
const balancedConfig: ProcessorConfig = {
  batchSize: 10,
  concurrency: 5,
  retryAttempts: 3,
  timeout: 1000,
  enableValidation: true
};

const processor = new DataProcessor(balancedConfig);
const results = await processor.processBatch(records);
```

**Performance Tuning Guide:**
- **High throughput**: Increase batchSize and concurrency
- **High reliability**: Increase retryAttempts and timeout
- **Low latency**: Decrease timeout and retryAttempts
- **Memory constrained**: Decrease batchSize and concurrency

---

## Question 6: Practical Extension
**Question:** "I want to add a new event type for data enrichment. How should I implement this?"

### Answer:
**Step-by-Step Implementation:**

### Step 1: Define Event Type
Add to EventBus event types or as documentation:
```typescript
// Event types reference:
// - 'record.processing.started'
// - 'record.processing.completed'
// - 'record.processing.failed'
// - 'record.enriched' (NEW)
// - 'enrichment.failed' (NEW)
```

### Step 2: Create Enrichment Module
Create `src/core/data-enricher.ts`:

```typescript
import { DataRecord, EventPayload } from '../types';
import { eventBus } from './event-bus';
import { logger } from '../utils/logger';

export class DataEnricher {
  async enrichRecord(record: DataRecord): Promise<Record<string, unknown>> {
    try {
      logger.info('Starting data enrichment', { recordId: record.id });
      
      // Enrichment logic - e.g., call external APIs
      const enrichedPayload = {
        ...record.payload,
        enriched: true,
        enrichmentTimestamp: Date.now(),
        // Add enriched fields from external sources
      };
      
      // Publish success event
      await eventBus.publish('record.enriched', {
        recordId: record.id,
        enrichedData: enrichedPayload
      }, record.id);
      
      return enrichedPayload;
    } catch (error) {
      logger.error('Enrichment failed', error as Error, { recordId: record.id });
      
      // Publish failure event
      await eventBus.publish('enrichment.failed', {
        recordId: record.id,
        error: error instanceof Error ? error.message : String(error)
      }, record.id);
      
      throw error;
    }
  }
}
```

### Step 3: Integrate with DataProcessor
Modify `src/core/data-processor.ts`:

```typescript
import { DataEnricher } from './data-enricher';

export class DataProcessor {
  private enricher: DataEnricher;
  
  constructor(config: ProcessorConfig) {
    this.config = config;
    this.enricher = new DataEnricher();
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // ... existing handlers ...
    
    // Subscribe to enrichment events
    eventBus.subscribe('record.enriched', async (payload) => {
      logger.info('Record enriched successfully', payload.data);
    });
    
    eventBus.subscribe('enrichment.failed', async (payload) => {
      logger.warn('Record enrichment failed', payload.data);
    });
  }
  
  private async transformRecord(record: DataRecord): Promise<Record<string, unknown>> {
    // Call enricher before transformation
    const enrichedPayload = await this.enricher.enrichRecord(record);
    
    // Continue with existing transformation
    return {
      id: record.id,
      processedAt: Date.now(),
      source: record.source,
      data: enrichedPayload,
      metadata: record.metadata
    };
  }
}
```

### Step 4: Subscribe to New Events in Application
In `src/index.ts`:

```typescript
// Subscribe to enrichment events
eventBus.subscribe('record.enriched', async (payload) => {
  logger.info('Enrichment event received', {
    recordId: (payload.data as { recordId: string }).recordId
  });
}, { priority: 10 });

eventBus.subscribe('enrichment.failed', async (payload) => {
  logger.error('Enrichment failed event', undefined, {
    recordId: (payload.data as { recordId: string }).recordId
  });
}, { priority: 5 });
```

### Step 5: Add Types (Optional)
Extend `src/types/index.ts`:

```typescript
export interface EnrichmentConfig {
  enableEnrichment: boolean;
  enrichmentTimeout: number;
  enrichmentRetries: number;
}

export interface EnrichedRecord extends DataRecord {
  enrichmentData?: Record<string, unknown>;
  enrichedAt?: number;
}
```

**Key Design Principles Applied:**
- **Decoupling**: Enricher publishes events rather than returning data directly
- **Error Handling**: Separate failure event for error handling
- **Correlation**: Uses correlationId for request tracing
- **Logging**: Context-aware logging at each step
- **Extensibility**: Other modules can subscribe without modifying enricher

---

## Question 7: Debugging Scenario
**Question:** "Records are processing but events aren't being received. What could be wrong and how would you debug this?"

### Answer:
**Possible Issues and Debugging Steps:**

### Issue 1: Subscription Not Registered
**Symptoms:** Events published but handlers never called

**Debugging:**
```typescript
// Check subscriptions exist
const subs = eventBus.getSubscriptions('record.processing.completed');
console.log('Subscriptions:', subs.length); // Should be > 0

// Solution: Ensure subscribe() called before processing
// WRONG order:
dataProcessor.processBatch(records); // Events published immediately
eventBus.subscribe('record.processing.completed', handler); // Too late!

// CORRECT order:
eventBus.subscribe('record.processing.completed', handler);
dataProcessor.processBatch(records);
```

### Issue 2: Wrong Event Type Name
**Symptoms:** Subscribed to wrong event name

**Debugging:**
```typescript
// Check what events are actually published
eventBus.use(async (payload) => {
  console.log('Event type:', payload.type); // Log all events
  return payload;
});

// Look in logs for published event names:
// Should see: 'record.processing.started'
// Should see: 'record.processing.completed'
// Should see: 'record.processing.failed'
```

### Issue 3: Handler Async Execution
**Symptoms:** Code after eventBus.publish() executes before handlers

**Debugging:**
```typescript
// Remember: publish() returns Promise
// WRONG:
eventBus.publish('record.processing.completed', data);
console.log('Event published'); // Logs before handlers execute!

// CORRECT:
await eventBus.publish('record.processing.completed', data);
console.log('Event published and handled'); // Logs after handlers

// In test:
const promise = eventBus.publish('event.type', data);
expect(promise).resolves.toBeUndefined();
```

### Issue 4: Event Handler Errors
**Symptoms:** Handler throws error, event processing stops

**Debugging:**
```typescript
// Enable DEBUG logging to see handler errors
logger.setLevel(LogLevel.DEBUG);

// Handler errors are logged but don't crash:
// Look for: "Event handler error" in logs

// Add error handling in handler:
eventBus.subscribe('record.processing.completed', async (payload) => {
  try {
    // Handler logic
    console.log('Handler executing');
  } catch (error) {
    logger.error('Handler error', error as Error);
    // Error is still logged by EventBus
  }
});
```

### Issue 5: Event Filter Not Matching
**Symptoms:** Event published but filter prevents handler execution

**Debugging:**
```typescript
// Subscribe with filter
eventBus.subscribe('record.processing.completed', handler, {
  filter: (payload) => {
    const data = payload.data as Record<string, unknown>;
    const matches = data.recordId === 'rec_001';
    console.log('Filter matches:', matches); // Debug filter
    return matches;
  }
});

// Check payload structure in logs
```

### Issue 6: Middleware Modifying Data
**Symptoms:** Handler receives modified event data

**Debugging:**
```typescript
// Check what middleware is registered
eventBus.use(async (payload) => {
  console.log('Middleware input:', payload);
  // Middleware might change payload.data
  return {
    ...payload,
    data: { ...payload.data as Record<string, unknown>, added: true }
  };
});

// Verify data shape in handlers
eventBus.subscribe('record.processing.completed', async (payload) => {
  console.log('Handler received:', JSON.stringify(payload.data, null, 2));
});
```

### Complete Debugging Checklist:

```typescript
// 1. Enable debug logging
logger.setLevel(LogLevel.DEBUG);

// 2. Add diagnostic middleware
eventBus.use(async (payload) => {
  console.log(`[Event Debug] Type: ${payload.type}, Subs: ${eventBus.getSubscriptions(payload.type).length}`);
  return payload;
});

// 3. Add handler with logging
eventBus.subscribe('record.processing.completed', async (payload) => {
  console.log('[Handler] Executing for:', payload.data);
  // Your logic
}, { priority: 10 });

// 4. Verify subscription
const count = eventBus.getSubscriptions('record.processing.completed').length;
console.log(`[Check] ${count} subscriptions to record.processing.completed`);

// 5. Await publish
await eventBus.publish('record.processing.completed', {
  recordId: 'test',
  status: 'success'
});
console.log('[Check] Event published and awaited');

// 6. Check processor is creating context
const context = processor.getProcessingStatus('rec_001');
console.log('[Check] Processing context:', context);
```

---

## Question 8: Code Flow Analysis
**Question:** "Trace the complete flow from when a DataRecord is created to when a ProcessingResult is returned."

### Answer:
**Complete End-to-End Flow:**

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: INITIALIZATION                                      │
└─────────────────────────────────────────────────────────────┘

main() in src/index.ts
  ├─ logger.setLevel(LogLevel.INFO)
  │
  ├─ Create ApiClient (not used in basic example)
  │
  ├─ Create ProcessorConfig
  │  └─ batchSize: 10, concurrency: 5, retryAttempts: 3, timeout: 1000
  │
  ├─ new DataProcessor(processorConfig)
  │  ├─ Store config
  │  ├─ Initialize processingQueue: Map<string, ProcessingContext>
  │  └─ setupEventHandlers()
  │     ├─ subscribe('record.processing.started')
  │     ├─ subscribe('record.processing.completed')
  │     └─ subscribe('record.processing.failed')
  │
  └─ eventBus.subscribe('record.processing.completed', handler)


┌─────────────────────────────────────────────────────────────┐
│ STEP 2: BATCH SUBMISSION                                    │
└─────────────────────────────────────────────────────────────┘

const sampleRecords: DataRecord[] = [
  { id: 'rec_001', timestamp, source, payload, metadata },
  { id: 'rec_002', timestamp, source, payload, metadata },
  ...
]

await dataProcessor.processBatch(sampleRecords)
  ├─ logger.info('Starting batch processing', details)
  │
  ├─ createBatches(records, batchSize: 10)
  │  └─ Split 3 records into 1 batch of 3 records
  │
  └─ for (const batch of batches) [1 iteration with 3 records]
     └─ processBatchWithConcurrency(batch)


┌─────────────────────────────────────────────────────────────┐
│ STEP 3: BATCH CONCURRENCY CONTROL                           │
└─────────────────────────────────────────────────────────────┘

processBatchWithConcurrency([rec_001, rec_002, rec_003])
  ├─ executing: Promise[] = []
  │
  ├─ FOR EACH record in batch:
  │  │
  │  ├─ FOR rec_001:
  │  │  ├─ promise = processRecord(rec_001).then(result => results.push)
  │  │  ├─ executing.push(promise)
  │  │  └─ executing.length (1) < concurrency (5) → continue
  │  │
  │  ├─ FOR rec_002:
  │  │  ├─ promise = processRecord(rec_002).then(result => results.push)
  │  │  ├─ executing.push(promise)
  │  │  └─ executing.length (2) < concurrency (5) → continue
  │  │
  │  └─ FOR rec_003:
  │     ├─ promise = processRecord(rec_003).then(result => results.push)
  │     ├─ executing.push(promise)
  │     └─ executing.length (3) < concurrency (5) → continue
  │
  └─ await Promise.all(executing) → Wait for all 3 to complete


┌─────────────────────────────────────────────────────────────┐
│ STEP 4: INDIVIDUAL RECORD PROCESSING (For each record)      │
└─────────────────────────────────────────────────────────────┘

processRecord(rec_001)
  │
  ├─ Create ProcessingContext
  │  └─ context = {
  │       recordId: 'rec_001',
  │       status: PROCESSING,
  │       attempts: 0,
  │       startedAt: Date.now()
  │     }
  │
  ├─ processingQueue.set('rec_001', context)
  │
  ├─ TRY BLOCK:
  │  │
  │  ├─ await eventBus.publish('record.processing.started', {...}, 'rec_001')
  │  │  ├─ Create EventPayload
  │  │  │  └─ { type, data, correlationId, timestamp }
  │  │  │
  │  │  ├─ Pass through middleware
  │  │  │  └─ Middleware adds 'middlewareProcessed: true'
  │  │  │
  │  │  ├─ Get subscriptions for 'record.processing.started'
  │  │  │
  │  │  ├─ Execute handlers (in priority order)
  │  │  │  └─ No explicit handlers in example, but processor's handler logs
  │  │  │
  │  │  └─ Promise.allSettled(handlerPromises)
  │  │
  │  ├─ Check enableValidation (true)
  │  │  └─ validateDataRecord(rec_001)
  │  │     ├─ Check id: 'rec_001' ✓ non-empty string
  │  │     ├─ Check timestamp: valid number ✓
  │  │     ├─ Check payload: valid object ✓
  │  │     ├─ Check source: valid string ✓
  │  │     └─ Return true (validation passed)
  │  │
  │  ├─ await transformRecord(rec_001)
  │  │  ├─ Simulate processing: await delay(10)
  │  │  └─ Return transformed object
  │  │     └─ { id, processedAt, source, data: {...}, metadata: {...} }
  │  │
  │  ├─ Update context
  │  │  ├─ status = COMPLETED
  │  │  └─ completedAt = Date.now()
  │  │
  │  ├─ await eventBus.publish('record.processing.completed', {...}, 'rec_001')
  │  │  ├─ Create EventPayload
  │  │  ├─ Pass through middleware
  │  │  ├─ Execute matching handlers
  │  │  │  └─ Main handler logs: "Processing completion event received"
  │  │  └─ Promise.allSettled()
  │  │
  │  ├─ processingQueue.delete('rec_001')
  │  │
  │  └─ RETURN ProcessingResult
  │     └─ {
  │          success: true,
  │          recordId: 'rec_001',
  │          processedAt: completedAt timestamp,
  │          transformedData: {...}
  │        }
  │
  └─ CATCH BLOCK (if error):
     │
     ├─ context.attempts += 1
     ├─ context.error = error
     │
     ├─ if (attempts < retryAttempts)
     │  ├─ context.status = RETRYING
     │  ├─ logger.warn('Retrying record processing')
     │  ├─ await delay(timeout)
     │  └─ RECURSIVE: return processRecord(record) → Back to STEP 4
     │
     └─ else (max retries exhausted)
        ├─ context.status = FAILED
        ├─ context.completedAt = Date.now()
        ├─ await eventBus.publish('record.processing.failed', {...})
        ├─ processingQueue.delete('rec_001')
        └─ RETURN ProcessingResult
           └─ {
                success: false,
                recordId: 'rec_001',
                processedAt: completedAt,
                errors: [error message]
              }


┌─────────────────────────────────────────────────────────────┐
│ STEP 5: BATCH COMPLETION & RESULTS                          │
└─────────────────────────────────────────────────────────────┘

All promises resolved → processBatchWithConcurrency returns results

processBatch() continues:
  ├─ Compile results array (3 ProcessingResult objects)
  │
  ├─ Calculate statistics
  │  ├─ successCount = 2 (rec_001, rec_002 succeeded)
  │  └─ failureCount = 1 (rec_003 failed)
  │
  ├─ logger.info('Batch processing completed', stats)
  │
  ├─ Return results: ProcessingResult[]


┌─────────────────────────────────────────────────────────────┐
│ STEP 6: RESULT CONSUMPTION                                  │
└─────────────────────────────────────────────────────────────┘

results = await dataProcessor.processBatch(sampleRecords)

results = [
  {
    success: true,
    recordId: 'rec_001',
    processedAt: 1701432000000,
    transformedData: { id, processedAt, source, data, metadata }
  },
  {
    success: true,
    recordId: 'rec_002',
    processedAt: 1701432000010,
    transformedData: { ... }
  },
  {
    success: false,
    recordId: 'rec_003',
    processedAt: 1701432003000,
    errors: ['Validation failed: Timestamp is required']
  }
]

// Process results
successCount = 2
failureCount = 1

results.forEach(result => {
  if (result.success) {
    logger.debug('Record processed successfully', { recordId, processedAt })
  } else {
    logger.warn('Record processing failed', { recordId, errors })
  }
})

activeProcesses = processor.getActiveProcesses()
// Should be empty since all records removed from queue


┌─────────────────────────────────────────────────────────────┐
│ STEP 7: APPLICATION SHUTDOWN                                │
└─────────────────────────────────────────────────────────────┘

logger.info('Application shutting down')
// Graceful exit or continue with next batch
```

**Key Flow Characteristics:**

1. **Synchronous Setup** → **Async Processing** → **Sequential Logging**
2. **Event-Driven Communication** with publish/subscribe
3. **Retry Loop** using recursion within catch block
4. **Concurrency Control** using Promise.race() in batch processing
5. **Context Tracking** via processingQueue Map
6. **Error Propagation** from validation → transformation → publishing

---

## Question 9: Design Patterns
**Question:** "What design patterns are used in this codebase? Give examples from the code."

### Answer:

### 1. **Pub-Sub (Publish-Subscribe) Pattern**
**Location:** `src/core/event-bus.ts`
**Purpose:** Decoupled event communication

```typescript
// Publisher: DataProcessor
await eventBus.publish('record.processing.completed', {
  recordId: record.id,
  transformedData
}, record.id);

// Subscriber: main() in index.ts
eventBus.subscribe('record.processing.completed', async (payload) => {
  logger.info('Processing completion event received', { 
    recordId: payload.data.recordId 
  });
}, { priority: 10 });
```

**Benefits:**
- Loose coupling between components
- Easy to add new handlers without modifying source
- Multiple handlers can react to same event
- Supports priority-based execution

---

### 2. **Singleton Pattern**
**Location:** `src/core/event-bus.ts`, `src/utils/logger.ts`
**Purpose:** Single global instance for cross-module access

```typescript
// EventBus singleton
export const eventBus = new EventBus();

// Logger singleton
export const logger = new Logger(LogLevel.INFO);

// Used everywhere
import { eventBus } from './core/event-bus';
import { logger } from './utils/logger';
// Single instance shared across entire app
```

**Benefits:**
- Centralized state
- Guaranteed single point of control
- Easy global configuration

---

### 3. **Decorator Pattern (Middleware)**
**Location:** `src/core/event-bus.ts`
**Purpose:** Add functionality to events before delivery

```typescript
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

// Any event published now passes through middleware first
await eventBus.publish('record.processing.completed', data);
```

**Benefits:**
- Non-invasive enhancement of events
- Composable middleware chain
- Can add logging, transformation, filtering

---

### 4. **Retry Pattern (with Exponential Backoff)**
**Location:** `src/core/api-client.ts`, `src/core/data-processor.ts`
**Purpose:** Recover from transient failures

```typescript
// API Client: Exponential backoff
if (this.shouldRetry(error, config._retryCount)) {
  config._retryCount += 1;
  await this.delay(this.config.retryDelay * config._retryCount); // 1s, 2s, 3s
  return this.client.request(config);
}

// Data Processor: Retry with recursion
if (context.attempts < this.config.retryAttempts) {
  context.status = ProcessingStatus.RETRYING;
  await this.delay(this.config.timeout);
  return this.processRecord(record); // Recursive retry
}
```

**Benefits:**
- Handles transient failures gracefully
- Exponential backoff prevents overwhelming servers
- Configurable retry behavior

---

### 5. **Factory Pattern**
**Location:** `src/utils/validator.ts`
**Purpose:** Create pre-configured validators

```typescript
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

// Usage
const validator = createDefaultValidator();
```

**Benefits:**
- Encapsulates validator creation logic
- Reusable pre-configured instances
- Easy to create variations

---

### 6. **Builder/Configuration Pattern**
**Location:** `src/core/api-client.ts`, `src/core/data-processor.ts`
**Purpose:** Flexible object construction with configuration

```typescript
interface ApiClientConfig {
  baseURL: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  headers?: Record<string, string>;
}

const apiClient = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  retryAttempts: 3,
  retryDelay: 1000,
  headers: { 'Content-Type': 'application/json' }
});
```

**Benefits:**
- Clear, readable configuration
- Optional parameters handled elegantly
- Easy to create variants

---

### 7. **Strategy Pattern**
**Location:** `src/utils/validator.ts` (ValidationRule)
**Purpose:** Encapsulate validation strategies

```typescript
interface ValidationRule {
  field: string;
  validator: (value: unknown) => boolean; // Strategy function
  errorMessage: string;
}

// Different strategies for different rules
const rules: ValidationRule[] = [
  {
    field: 'id',
    validator: (value) => typeof value === 'string', // String strategy
    errorMessage: 'Must be string'
  },
  {
    field: 'amount',
    validator: (value) => typeof value === 'number' && value > 0, // Number strategy
    errorMessage: 'Must be positive number'
  }
];
```

**Benefits:**
- Encapsulates validation logic
- Easy to add new validation rules
- Reusable across records

---

### 8. **Observer Pattern**
**Location:** Event handlers throughout the code
**Purpose:** React to state changes

```typescript
// Data Processor creates context objects that are observed
private processingQueue: Map<string, ProcessingContext> = new Map();

// Other modules can observe status via event subscriptions
eventBus.subscribe('record.processing.started', async (payload) => {
  // React to state change
  logger.info('Processing started');
});

eventBus.subscribe('record.processing.completed', async (payload) => {
  // React to state change
  logger.info('Processing completed');
});
```

**Benefits:**
- Loose coupling between observers
- Multiple observers can react to same event
- State changes trigger appropriate reactions

---

### 9. **Chain of Responsibility Pattern**
**Location:** `src/core/event-bus.ts` (middleware + handlers)
**Purpose:** Process events through a chain

```typescript
// Middleware chain
for (const middleware of this.middleware) {
  processedPayload = await middleware(processedPayload);
}

// Handler chain (in priority order)
const matchingSubscriptions = subscriptions.filter(sub => 
  !sub.filter || sub.filter(processedPayload)
);

const handlerPromises = matchingSubscriptions.map(async (subscription) => {
  await subscription.handler(processedPayload);
});

await Promise.allSettled(handlerPromises);
```

**Benefits:**
- Flexible processing pipeline
- Each middleware/handler focuses on one concern
- Easy to add/remove steps

---

### 10. **Custom Error Classes Pattern**
**Location:** `src/core/api-client.ts`, `src/core/data-processor.ts`, `src/utils/validator.ts`
**Purpose:** Domain-specific error handling

```typescript
export class ApiClientError extends Error {
  constructor(message, public readonly statusCode?, public readonly response?) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ProcessingError extends Error {
  constructor(message, public readonly recordId, public readonly context?) {
    super(message);
    this.name = 'ProcessingError';
  }
}

export class ValidationError extends Error {
  constructor(message, public readonly field, public readonly value) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Usage: Type-specific error handling
try {
  await processor.processRecord(record);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(`Validation failed on field: ${error.field}`);
  } else if (error instanceof ProcessingError) {
    console.log(`Processing failed for record: ${error.recordId}`);
  }
}
```

**Benefits:**
- Clear error types for handling
- Encapsulate error context
- Better debugging information

---

## Question 10: Improvements
**Question:** "What are potential improvements or issues you notice in the current implementation?"

### Answer:

### 1. **Retry Logic Issues**

**Issue:** Recursive retry in DataProcessor can cause stack overflow
```typescript
// Current implementation (risky)
catch (error) {
  if (context.attempts < this.config.retryAttempts) {
    return this.processRecord(record); // Recursive!
  }
}
```

**Problem:**
- Deep recursion can exceed stack size with many retries
- Harder to debug with deep stack traces
- No exponential backoff (unlike ApiClient)

**Improvement:**
```typescript
async processRecord(record: DataRecord): Promise<ProcessingResult> {
  const context: ProcessingContext = { ... };
  
  while (context.attempts < this.config.retryAttempts) {
    try {
      // Processing logic
      return { success: true, ... };
    } catch (error) {
      context.attempts++;
      if (context.attempts >= this.config.retryAttempts) {
        return { success: false, errors: [...] };
      }
      // Exponential backoff
      const delay = Math.min(this.config.timeout * Math.pow(2, context.attempts), 30000);
      await this.delay(delay);
    }
  }
}
```

---

### 2. **Memory Leak in processingQueue**

**Issue:** Context objects might not be deleted if exceptions occur
```typescript
// Current code
try {
  // ... processing
  this.processingQueue.delete(record.id);
} catch (error) {
  // ... error handling
  this.processingQueue.delete(record.id); // Duplicated in both paths
}
```

**Problem:**
- If both success and error blocks are reached, object deleted twice
- No cleanup for abandoned records
- Queue grows with orphaned entries

**Improvement:**
```typescript
async processRecord(record: DataRecord): Promise<ProcessingResult> {
  const context: ProcessingContext = { ... };
  this.processingQueue.set(record.id, context);
  
  try {
    // ... processing
    return { success: true, ... };
  } catch (error) {
    // ... error handling
    return { success: false, ... };
  } finally {
    // Guaranteed cleanup
    this.processingQueue.delete(record.id);
  }
}
```

---

### 3. **Missing Timeout Mechanism**

**Issue:** No timeout for long-running record processing
```typescript
// Current: processRecord doesn't have a timeout
private async transformRecord(record: DataRecord): Promise<...> {
  await this.delay(10); // Only 10ms - unrealistic
  // What if actual transformation takes 10 seconds?
}
```

**Problem:**
- Records can hang indefinitely
- No protection against slow API calls
- Resource exhaustion possible

**Improvement:**
```typescript
async processRecord(record: DataRecord): Promise<ProcessingResult> {
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Processing timeout')), this.config.timeout)
  );
  
  try {
    return await Promise.race([
      this._performProcessing(record),
      timeoutPromise
    ]);
  } catch (error) {
    // Handle timeout error
  }
}
```

---

### 4. **Poor Error Context**

**Issue:** Lost error context through transformation
```typescript
// Current
catch (error) {
  const errorMessage = error instanceof ValidationError
    ? `Validation failed: ${error.message}`
    : error instanceof Error
    ? error.message
    : String(error);
  // Lost the original error object!
}
```

**Problem:**
- Stack trace lost
- Can't re-throw with context
- Debugging harder

**Improvement:**
```typescript
catch (error) {
  const processingError = new ProcessingError(
    error instanceof Error ? error.message : String(error),
    record.id,
    {
      originalError: error,
      timestamp: Date.now(),
      stage: 'transformation',
      config: this.config
    }
  );
  
  // Publish with full context
  await eventBus.publish('record.processing.failed', {
    recordId: record.id,
    error: processingError,
    attempts: context.attempts
  }, record.id);
}
```

---

### 5. **No Backpressure Handling**

**Issue:** No mechanism to slow down if downstream systems are overwhelmed
```typescript
// Current: Just publishes events regardless of subscriber state
await eventBus.publish('record.processing.completed', data);
// What if subscribers can't keep up?
```

**Problem:**
- Memory builds up with pending events
- No feedback mechanism
- System can be overwhelmed

**Improvement:**
```typescript
interface EventPublishOptions {
  timeout?: number;
  maxRetries?: number;
  onBackpressure?: (eventType: string) => Promise<void>;
}

async publish(
  eventType: string, 
  data: unknown, 
  options?: EventPublishOptions
): Promise<void> {
  const pendingHandlers = this.subscriptions.get(eventType)?.length || 0;
  
  if (pendingHandlers > 100) {
    if (options?.onBackpressure) {
      await options.onBackpressure(eventType);
    }
  }
  
  // Proceed with publishing
}
```

---

### 6. **Insufficient Input Validation**

**Issue:** DataProcessor doesn't validate config
```typescript
// Current
constructor(config: ProcessorConfig) {
  this.config = config; // No validation!
}

// What if someone passes batchSize: -1 or concurrency: 0?
```

**Problem:**
- Silent failures with invalid config
- Errors appear downstream
- Hard to debug

**Improvement:**
```typescript
constructor(config: ProcessorConfig) {
  this.validateConfig(config);
  this.config = config;
}

private validateConfig(config: ProcessorConfig): void {
  if (config.batchSize < 1) {
    throw new Error('batchSize must be >= 1');
  }
  if (config.concurrency < 1) {
    throw new Error('concurrency must be >= 1');
  }
  if (config.retryAttempts < 0) {
    throw new Error('retryAttempts must be >= 0');
  }
  if (config.timeout < 0) {
    throw new Error('timeout must be >= 0');
  }
}
```

---

### 7. **Event Correlation Incomplete**

**Issue:** Correlation ID not consistently propagated
```typescript
// Current
await eventBus.publish('record.processing.started', {
  recordId: record.id,
  source: record.source
}, record.id); // Uses recordId as correlationId

// But what about API calls made during processing?
// Those don't inherit the correlationId
```

**Problem:**
- Distributed tracing impossible
- Can't follow request through system
- Debugging multi-service failures hard

**Improvement:**
```typescript
interface ProcessingContext {
  recordId: string;
  correlationId: string; // Add this
  status: ProcessingStatus;
  attempts: number;
  startedAt: number;
  completedAt?: number;
  error?: Error;
}

// Use correlationId in all operations
const context: ProcessingContext = {
  recordId: record.id,
  correlationId: this.generateCorrelationId(),
  status: ProcessingStatus.PROCESSING,
  attempts: 0,
  startedAt: Date.now()
};

// Pass to all nested calls
await this.apiClient.get(url, {
  headers: { 'X-Correlation-ID': context.correlationId }
});
```

---

### 8. **No Graceful Shutdown**

**Issue:** No way to gracefully stop processing
```typescript
// Current: No shutdown mechanism
export class DataProcessor {
  // Can't stop mid-batch
  // Active processes orphaned on exit
}
```

**Problem:**
- In-flight requests abandoned
- Data inconsistency
- Resource leaks

**Improvement:**
```typescript
private isShuttingDown = false;
private activeProcesses = new Set<string>();

async processRecord(record: DataRecord): Promise<ProcessingResult> {
  if (this.isShuttingDown) {
    throw new Error('Processor is shutting down');
  }
  
  this.activeProcesses.add(record.id);
  try {
    // ... processing
  } finally {
    this.activeProcesses.delete(record.id);
  }
}

async shutdown(timeoutMs = 30000): Promise<void> {
  this.isShuttingDown = true;
  const deadline = Date.now() + timeoutMs;
  
  while (this.activeProcesses.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  if (this.activeProcesses.size > 0) {
    logger.warn('Forced shutdown with active processes', {
      count: this.activeProcesses.size
    });
  }
}
```

---

### 9. **Missing Metrics/Observability**

**Issue:** No built-in metrics collection
```typescript
// Current: Only logging, no structured metrics
logger.info('Pipeline execution completed', {
  totalRecords: sampleRecords.length,
  successCount,
  failureCount
});
// These logs are hard to aggregate and analyze
```

**Problem:**
- Can't measure performance
- No alerts on degradation
- Can't optimize based on data

**Improvement:**
```typescript
interface ProcessingMetrics {
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  totalDuration: number;
  averageLatency: number;
  maxLatency: number;
  errors: Map<string, number>;
}

class DataProcessor {
  private metrics: ProcessingMetrics = { ... };
  
  async processBatch(records: DataRecord[]): Promise<ProcessingResult[]> {
    const startTime = Date.now();
    const results = await this._processBatch(records);
    const duration = Date.now() - startTime;
    
    this.metrics.recordsProcessed += records.length;
    this.metrics.totalDuration += duration;
    this.metrics.averageLatency = this.metrics.totalDuration / this.metrics.recordsProcessed;
    
    return results;
  }
  
  getMetrics(): ProcessingMetrics {
    return { ...this.metrics };
  }
}
```

---

### 10. **No Batch Failure Strategy**

**Issue:** Unclear behavior when batch partially fails
```typescript
// Current: Returns mixed success/failure results
const results = await processor.processBatch(records);
// Some succeeded, some failed - what now?
// Should we retry entire batch? Skip failures? Escalate?
```

**Problem:**
- Application must handle partial failures
- No built-in recovery strategy
- Inconsistent state possible

**Improvement:**
```typescript
enum BatchFailureStrategy {
  PARTIAL = 'partial', // Return mixed results
  RETRY = 'retry',     // Retry entire batch
  HALT = 'halt'        // Stop on first failure
}

async processBatch(
  records: DataRecord[],
  options?: { failureStrategy?: BatchFailureStrategy }
): Promise<ProcessingResult[]> {
  const strategy = options?.failureStrategy || BatchFailureStrategy.PARTIAL;
  
  if (strategy === BatchFailureStrategy.HALT) {
    for (const record of records) {
      const result = await this.processRecord(record);
      if (!result.success) {
        throw new ProcessingError(`Batch halted: ${result.recordId} failed`);
      }
      // Continue only if successful
    }
  }
  
  // ... other strategies
}
```

---

### Summary of Critical Issues:
| Issue | Severity | Impact |
|-------|----------|--------|
| Stack overflow from recursion | High | System crash |
| Memory leak in processingQueue | High | Memory exhaustion |
| No timeout mechanism | High | Hanging requests |
| Poor error context | Medium | Hard debugging |
| No backpressure handling | Medium | System overload |
| Insufficient input validation | Medium | Silent failures |
| Incomplete correlation ID | Medium | Poor observability |
| No graceful shutdown | Medium | Data loss risk |
| Missing metrics | Low | Can't optimize |
| No batch failure strategy | Low | Unclear recovery |

---

# Summary

This Enterprise Data Pipeline is a well-structured TypeScript system demonstrating:
- ✅ Clean architecture with clear separation of concerns
- ✅ Event-driven design for scalability
- ✅ Comprehensive type safety
- ✅ Multiple design patterns (Pub-Sub, Singleton, Retry, etc.)
- ⚠️ Some production-readiness improvements needed (timeout, backpressure, metrics)

The codebase is excellent for learning and can be production-ready with the suggested improvements.
