# Onboarding Assessment - Enterprise Data Pipeline

## Question 1: Architecture Overview
**Answer:** This is an event-driven TypeScript data processing pipeline for high-throughput batch processing and API integration. Architecture consists of three core modules: **ApiClient** (HTTP client with retry logic), **DataProcessor** (batch processor with concurrency control), and **EventBus** (pub-sub system). Support modules include Logger (structured logging) and Validator (rule-based validation). The system follows a layered architecture with clear separation of concerns.

## Question 2: Module Interactions - DataProcessor & EventBus
**Answer:** DataProcessor publishes three event types during processing:
1. `record.processing.started` - fired at start of `processRecord()` (line 54)
2. `record.processing.completed` - fired on success (line 64)
3. `record.processing.failed` - fired on failure after retries (line 91)

The EventBus receives events via `publish()`, applies middleware transformations, filters subscribers, and executes handlers asynchronously. DataProcessor also subscribes to its own events in `setupEventHandlers()` for logging purposes.

## Question 3: Retry Mechanism in ApiClient
**Answer:** Implemented in the response interceptor (lines 60-84 of api-client.ts):
- Tracks `_retryCount` on AxiosRequestConfig
- Retries when: (1) no response (network error), (2) status >= 500, or (3) status === 429
- Maximum attempts: `config.retryAttempts`
- Uses exponential backoff: `retryDelay * retryCount`
- Returns rejected promise after exhausting retries

## Question 4: Validation Failure Error Path
**Answer:** When validation fails:
1. `validateDataRecord()` in validator.ts throws `ValidationError` with field, value, message
2. Caught in `processRecord()` try-catch block (line 69)
3. Enters retry logic if attempts < `retryAttempts`
4. After exhausting retries: status set to FAILED, `record.processing.failed` event published
5. Returns `ProcessingResult` with `success: false` and error message
6. Logger captures warnings at each step

## Question 5: Batch Processing Configuration
**Answer:** Configure via `ProcessorConfig` interface:
- `batchSize`: Records per batch (default: 10)
- `concurrency`: Parallel processing limit (default: 5)
- `retryAttempts`: Max retries per record (default: 3)
- `timeout`: Processing delay in ms (default: 1000)
- `enableValidation`: Toggle validation (default: true)

Example:
```typescript
const config: ProcessorConfig = {
  batchSize: 20,
  concurrency: 10,
  retryAttempts: 5,
  timeout: 500,
  enableValidation: true
};
const processor = new DataProcessor(config);
```

## Question 6: Adding Data Enrichment Event
**Answer:** Implementation steps:
1. Subscribe to new event in main or processor setup:
```typescript
eventBus.subscribe('record.enrichment.needed', async (payload) => {
  const record = payload.data as DataRecord;
  // Enrich data here
  await eventBus.publish('record.enrichment.completed', enrichedData);
});
```
2. Publish from `transformRecord()` method:
```typescript
await eventBus.publish('record.enrichment.needed', record, record.id);
```
3. Add types to `types/index.ts` if needed for type safety

## Question 7: Debugging Events Not Received
**Answer:** Troubleshooting checklist:
1. Check subscription timing - subscribe **before** processing starts
2. Verify event type string matches exactly (case-sensitive)
3. Check filter functions - may be filtering out events
4. Review middleware - could be transforming/blocking events
5. Check logger level - set to DEBUG to see event flow
6. Use `eventBus.getSubscriptions(eventType)` to verify subscriptions exist
7. Ensure async handlers don't throw unhandled errors (check logs)

## Question 8: Complete Data Flow Trace
**Answer:** 
1. **Entry**: `processBatch()` receives `DataRecord[]`
2. **Batching**: Records split into batches via `createBatches()`
3. **Concurrency Control**: `processBatchWithConcurrency()` limits parallel execution
4. **Processing**: For each record, `processRecord()` creates `ProcessingContext`
5. **Event**: Publish `record.processing.started`
6. **Validation**: If enabled, `validateDataRecord()` validates required fields
7. **Transform**: `transformRecord()` enriches data, adds metadata
8. **Success Path**: Publish `record.processing.completed`, return `ProcessingResult` with `success: true`
9. **Error Path**: Retry up to `retryAttempts`, then publish `record.processing.failed`
10. **Aggregation**: Results collected and returned as `ProcessingResult[]`

## Question 9: Design Patterns
**Answer:**
- **Pub-Sub Pattern**: EventBus implements observer pattern for decoupled communication
- **Middleware Pattern**: EventBus supports transformation pipeline (line 88-91 event-bus.ts)
- **Retry Pattern**: Exponential backoff in ApiClient and DataProcessor
- **Batch Processing Pattern**: Chunking large datasets with concurrency control
- **Strategy Pattern**: Configurable validation rules via `ValidationRule` interface
- **Factory Pattern**: `createDefaultValidator()` creates preconfigured validators
- **Error Handling Pattern**: Custom error classes (`ApiClientError`, `ValidationError`, `ProcessingError`)

## Question 10: Potential Improvements
**Answer:**
1. **Performance**: Race condition in `processBatchWithConcurrency()` - removing from array during iteration is inefficient. Use concurrent queue instead.
2. **Memory**: `processingQueue` Map never cleared for in-progress items if app crashes
3. **Testing**: No integration tests or API client mocks
4. **Error Handling**: Lost retry context - retries restart from attempt 0 in recursive call
5. **Observability**: No metrics (throughput, latency, error rates)
6. **Configuration**: Hardcoded delays and no environment-based config
7. **Type Safety**: EventBus uses `unknown` types - should use generics
8. **Backpressure**: No queue size limits or backpressure handling
9. **Graceful Shutdown**: No cleanup on app termination
10. **Documentation**: Missing JSDoc for public APIs like `processBatch()`

---

## Summary
This codebase demonstrates solid TypeScript architecture with event-driven design. The modular structure allows independent testing and extension. Key strengths: comprehensive error handling, retry mechanisms, and structured logging. Main areas for improvement: performance optimizations, enhanced type safety, and production observability features.
