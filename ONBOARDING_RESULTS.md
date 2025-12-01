# Onboarding Results

## Overview
This file contains a concise onboarding summary and answers to the 10 questions provided in `onboarding_test_prompt.md`.

---

## Q1: Architecture Overview
**Answer:**
This project is an event-driven data processing pipeline written in TypeScript. Core components include:
- `ApiClient` (`src/core/api-client.ts`) — Axios-based HTTP client with retry and interceptor logic.
- `DataProcessor` (`src/core/data-processor.ts`) — Batch processing engine that transforms and validates records, supports concurrency and retries.
- `EventBus` (`src/core/event-bus.ts`) — A publish/subscribe system with middleware and prioritized handlers.
- Utilities: `logger` (`src/utils/logger.ts`) for structured logging and `validator` (`src/utils/validator.ts`) for data validation.

The system flow: data records are submitted to `DataProcessor`, which validates, transforms, and publishes events at lifecycle stages. `ApiClient` is provided for external integration, while `EventBus` offers decoupled notifications and extension points for other parts of the system.

---

## Q2: Module Interactions (DataProcessor <-> EventBus)
**Answer and Trace:**
1. `DataProcessor` subscribes to lifecycle events in `setupEventHandlers()` (constructor):
   - `'record.processing.started'`, `'record.processing.completed'`, `'record.processing.failed'`
   - The handlers log these events through `logger.info`/`logger.error`.
2. When `processRecord()` runs:
   - It creates a `ProcessingContext`, sets the record as active in `processingQueue`.
   - It publishes `'record.processing.started'` with `eventBus.publish('record.processing.started', { recordId, source }, record.id);`.
   - After processing, it publishes `'record.processing.completed'` with transformed data.
   - If processing fails, it retries up to `retryAttempts`, and after retries are exhausted, it publishes `'record.processing.failed'` with error details.
3. `eventBus` runs any middleware added by `eventBus.use()` before invoking subscribed handlers, and handlers are executed asynchronously; `publish()` uses `Promise.allSettled` to ensure all handlers are awaited without causing a single failure to stop other notifications.

So the DataProcessor both uses `eventBus.publish()` to broadcast lifecycle events and registers internal handlers to log or react to the events.

---

## Q3: ApiClient Retry Mechanism
**Answer and Trace:**
- Implemented in `src/core/api-client.ts` inside `setupInterceptors()` response error handler.
- On Axios error, the code uses a `config._retryCount` property in the `AxiosRequestConfig` to track attempts.
- It calls `shouldRetry(error, retryCount)`, which returns `true` when:
  - `retryCount < config.retryAttempts` and
  - The error is a network error (no response) OR HTTP response status is 5xx OR status is 429 (Too Many Requests).
- Retry behaviour: increments `_retryCount`, waits `retryDelay * _retryCount` ms (i.e., a linear backoff), logs a retry, then reissues the request via `this.client.request(config)`.
- If retries fail, it logs and throws an `ApiClientError`.

---

## Q4: Validation Failure Error Path
**Answer and Trace:**
1. `DataProcessor.processRecord()` checks `this.config.enableValidation` and calls `validateDataRecord(record)` from `src/utils/validator.ts`.
2. `validateDataRecord()` throws a `ValidationError` (subclass of Error) if required fields are missing or invalid.
3. `processRecord()` catches the error in a try/catch block:
   - increments `context.attempts` and if attempts < `retryAttempts`, sets status to RETRYING and calls `processRecord` again after a delay.
   - If attempts have reached `retryAttempts`, sets status to FAILED, publishes `'record.processing.failed'` with error and attempts, deletes the record from `processingQueue` and returns a `ProcessingResult` with `success: false` and `errors: [errorMessage]`.
4. This flow ensures validation issues produce events and fail results; the `ValidationError` class is used to format a clearer message.

---

## Q5: Customizing Batch Processing Behavior
**Answer:**
Batch processing can be customized using `ProcessorConfig` (see `src/types/index.ts` and README):
- `batchSize` (number): how many records per batch.
- `concurrency` (number): how many records to process in parallel within each batch.
- `retryAttempts` (number): how many times to retry on failure.
- `timeout` (number): per-record delay/retry timeout (ms).
- `enableValidation` (boolean): enable/disable record validation.

To customize, instantiate `DataProcessor` with a `ProcessorConfig`:
```ts
const processor = new DataProcessor({ batchSize: 10, concurrency: 5, retryAttempts: 3, timeout: 1000, enableValidation: true });
```

---

## Q6: Adding a New Event Type for Data Enrichment
**How-to:**
1. Decide the event name and payload (e.g., `record.enrichment.completed`).
2. Add publishing in `DataProcessor` where enrichment occurs:
   - In `transformRecord()` or after a dedicated enrichment step, add `await eventBus.publish('record.enrichment.completed', { recordId, enrichmentData }, record.id);`.
3. Add subscribers where needed (in `index.ts` or other modules):
   - `eventBus.subscribe('record.enrichment.completed', async (payload) => { /* handle */ }, { priority: 5 });`
4. Optionally add middleware: `eventBus.use()` to add or modify event payload.
5. Add unit-tests to ensure enrichment event is published and subscribers receive it.

Example in `DataProcessor.transformRecord()`:
```ts
const enrichmentData = await enrich(record.payload);
await eventBus.publish('record.enrichment.completed', { recordId: record.id, enrichmentData }, record.id);
```

---

## Q7: Debugging Missing Event Deliveries
**Common causes & steps:**
1. No subscribers registered: Verify `eventBus.subscribe()` was called for the event type used.
2. Filtering or priority mismatch: A `filter` option may filter events; check subscription filters.
3. Middleware modifies payload incorrectly: A middleware may transform or drop events. Check `eventBus.use()` for side effects or exceptions.
4. Exceptions in handlers: Handlers might throw errors; `EventBus.publish()` wraps handlers in try/catch and logs errors, but you should inspect logs (logger) for handler errors.
5. Wrong `eventType` or correlationId: Ensure event names match and `publish()` uses the same type as subscriptions.
6. Race conditions: If the subscription is created after `publish()` is called, the event won't be received — ensure subscription is set up before events.

Debug steps:
- Verify subscription present with `eventBus.getSubscriptions('type')`.
- Enable `logger` to `DEBUG` to trace publish/subscribe:
  - `logger.setLevel(LogLevel.DEBUG)` in `index.ts`.
- Ensure middleware stack is not mutating payloads incorrectly; check `eventBus.use()` middleware.
- Add unit tests for the event type to assert publish/subscribe behavior.

---

## Q8: End-to-End Flow (DataRecord -> ProcessingResult)
**Trace:**
1. Application or caller supplies a `DataRecord` (e.g., in `index.ts` sample records).
2. `DataProcessor.processBatch(records)` is invoked.
3. `processBatch()` splits records into `batchSize` and loops over batches.
4. For each record, `processBatchWithConcurrency()` schedules `processRecord()` respecting `concurrency`.
5. `processRecord()`:
   - Creates `ProcessingContext` and adds to `processingQueue`.
   - Publishes `record.processing.started` via `eventBus.publish()`.
   - Optionally validates the record with `validateDataRecord()`.
   - Calls `transformRecord()` to enrich/transform the payload.
   - Updates context to COMPLETED and publishes `record.processing.completed`.
   - Deletes context from `processingQueue`.
   - Returns a `ProcessingResult` with `success: true`, transformed data and `processedAt` timestamp.
6. If any step fails, `processRecord()` increments `context.attempts`, retries if allowed, or publishes `record.processing.failed` and returns a failure `ProcessingResult`.

---

## Q9: Design Patterns Observed
**Patterns used:**
- **Publish/Subscribe (Observer)**: `EventBus` implements event subscriptions with middleware and priorities (`src/core/event-bus.ts`).
- **Builder / Config objects**: `ApiClient` and `DataProcessor` accept config objects (`ApiClientConfig`, `ProcessorConfig`) to customize behavior.
- **Strategy / Pluggable Middleware**: The `EventBus.use()` middleware pattern allows plug-in transformations for events.
- **Retry Pattern with backoff**: `ApiClient` implements retries with backoff for transient errors.
- **Command/Task Queue**: The `DataProcessor` uses a processing queue (`processingQueue`) to track active contexts and to limit concurrency.

---

## Q10: Suggested Improvements and Potential Issues
**Improvements & Observations:**
1. Retry Backoff Exponentialization: Current retry uses `retryDelay * retryCount` (linear). For better resilience, implement exponential backoff with jitter.
2. Concurrency handling: `processBatchWithConcurrency()` uses `executing` and `Promise.race`, but the `splice` logic may not always remove the right resolved promise. Consider using a token-based semaphore or `p-limit` to simplify concurrency correctness.
3. Cancellation & timeouts: Use `AbortController` or axios cancellation tokens to abort requests/processing when `timeout` occurs, rather than only sleeping.
4. Stronger Type Safety: In some areas, `any`/`unknown` is used (e.g., event `data` and `headers` typings). Consider stricter generics for EventPayload and ApiResponse usages.
5. Logging Context: Logger uses global context merging but could include more consistent correlation IDs (like using `ProcessingContext` correlation ID in logs for traceability).
6. Test Coverage: Add tests for `EventBus`, `ApiClient` retry paths, middleware behaviors, and concurrency/queue edge cases.
7. Error Hierarchy: Introduce more structured error types; current usage is `ValidationError`, `ProcessingError`, `ApiClientError` — consider expanding or consolidating error metadata.
8. Event Ordering Guarantees: If ordering is required, the EventBus would need to support ordered dispatch or a persistence mechanism.

---

## Quick Run / Dev Guide
- Install: `npm install`
- Build: `npm run build`
- Dev: `npm run dev` (uses `ts-node` to run `src/index.ts`)
- Test: `npm test`

---

## Final Notes
This project demonstrates a clean, modular approach to event-driven processing. Most functionality is present and straightforwardly extensible. Focus areas for improvement are reliability enhancements (backoff, cancellation), stronger typing, and increasing test coverage for edge cases.

---

*End of Onboarding Results*
