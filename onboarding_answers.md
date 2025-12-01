# Onboarding Understanding and Explanation Assessment

## Project Summary
- **Purpose:** Event-driven TypeScript data pipeline for batch processing, validation, transformation, and API integration.
- **Key Components:**
  - `src/core/data-processor.ts`: Batch/concurrent processing, retries, event publishing.
  - `src/core/event-bus.ts`: Publish–subscribe with middleware and priority.
  - `src/core/api-client.ts`: Axios wrapper with retryable HTTP calls.
  - `src/utils/logger.ts`: Structured logging with log levels.
  - `src/utils/validator.ts`: Rule-based validation and `ValidationError`.
  - `src/types/index.ts`: Shared contracts (`DataRecord`, `ProcessingResult`, `ProcessorConfig`, etc.).
- **Entry Point:** `src/index.ts` wires `ApiClient`, `DataProcessor`, subscriptions, middleware, and sample run.

---

## Q1. Architecture Overview
**Answer:** The system is a modular, event-driven pipeline. `DataProcessor` orchestrates record validation, transformation, and result emission while emitting lifecycle events on the `EventBus`. `ApiClient` abstracts HTTP calls with retryable Axios interceptors. Utilities provide logging and validation. Types centralize shared contracts. `src/index.ts` composes these pieces, registers event handlers/middleware, and kicks off processing.

---

## Q2. Module Interactions (DataProcessor ↔ EventBus)
**Answer:** `DataProcessor` subscribes to processing lifecycle events in its constructor (logging side effects). During `processRecord`:
1. Publishes `record.processing.started` (correlationId = record.id).
2. After validation and `transformRecord`, publishes `record.processing.completed` with `transformedData`.
3. On failure after exhausting retries, publishes `record.processing.failed` with error details and attempt count.
`EventBus` runs middleware sequentially, filters/prioritizes handlers, and executes handlers concurrently with error isolation.

---

## Q3. ApiClient Retry Mechanism
**Answer:** Implemented in `src/core/api-client.ts` via Axios response interceptor. On error, it increments `config._retryCount` and calls `shouldRetry` (max attempts, network errors, or HTTP 5xx/429). It waits `retryDelay * attempt` ms, logs, and re-issues the request. Public methods wrap errors as `ApiClientError` with status/response context.

---

## Q4. Validation Failure Path
**Answer:** `DataProcessor.processRecord` invokes `validateDataRecord` when `enableValidation` is true. A `ValidationError` is thrown for bad fields. The catch block increments `attempts`; if below `retryAttempts`, it delays then *recursively* re-calls `processRecord`. After max attempts, it publishes `record.processing.failed`, deletes the context, and returns a `ProcessingResult` with `success: false` and an errors array (prefixed with `Validation failed: ...`).

> ✅ **Note:** Retry logic now uses an iterative loop and treats `ValidationError` as non-retryable, preserving attempts and avoiding recursion/stack growth.

---

## Q5. Customizing Batch Processing
**Answer:** Configure `ProcessorConfig` (see `src/types/index.ts`):
- `batchSize`: Records per batch.
- `concurrency`: Max parallel `processRecord` calls per batch.
- `retryAttempts`: Max per-record retries.
- `timeout`: Delay (ms) between retries.
- `enableValidation`: Toggle `validateDataRecord`.
Pass the config to `new DataProcessor(config)`.

---

## Q6. Adding a New Event Type (Data Enrichment)
**Answer:**
1. Choose event names, e.g., `record.enrichment.started` / `record.enrichment.completed`.
2. Publish from the appropriate stage (e.g., inside `transformRecord` or before/after an enrichment step): `await eventBus.publish('record.enrichment.completed', { recordId, enrichedData }, recordId);`
3. Subscribe handlers where needed (e.g., in `index.ts` or a new module): `eventBus.subscribe('record.enrichment.completed', handler, { priority: 5 });`
4. Optionally add middleware for cross-cutting concerns (e.g., tagging, tracing).
5. Extend types by adding a typed payload interface if desired.

---

## Q7. Debugging Missing Events
**Answer:**
- Verify subscription exists and event names match (`eventBus.getSubscriptions(eventType)`).
- Ensure subscriptions are registered **before** publishing.
- Check filters/priorities and middleware for thrown errors (the bus logs handler errors but continues).
- Increase log level to `DEBUG` to see publish/subscription logs.
- Confirm `eventBus.clear()` wasn’t called inadvertently.
- Add temporary handlers or tests to assert publish delivery.

---

## Q8. End-to-End Flow (DataRecord → ProcessingResult)
**Answer:**
1. Record created (e.g., `src/index.ts` samples).
2. `DataProcessor.processBatch` splits into batches, then `processBatchWithConcurrency` schedules `processRecord` calls.
3. `processRecord` creates `ProcessingContext`, publishes `record.processing.started`, validates, and calls `transformRecord` (async enrichment stub).
4. On success: publishes `record.processing.completed`, removes context, returns `ProcessingResult` with `transformedData`.
5. On error: retries up to `retryAttempts`; after max, publishes `record.processing.failed`, removes context, returns failed `ProcessingResult` with errors.

---

## Q9. Design Patterns
- **Publish–Subscribe:** `EventBus` decouples producers/consumers (`subscribe`, `publish`).
- **Middleware Pipeline:** `eventBus.use` for pre-handler transformations.
- **Retry with Backoff:** `ApiClient` interceptor retries with linear backoff; `DataProcessor` retries records.
- **Strategy-esque Validation:** `Validator` holds rules; `validateDataRecord` is a specialized strategy.
- **Contextual Logging:** `Logger` maintains shared context and leveled output.

---

## Q10. Potential Improvements
1. **Retry Strategy Enhancements:** Consider exponential backoff with jitter; further distinguish transient vs non-retryable errors beyond validation.
2. **Event Typing:** Strongly type event payloads (e.g., discriminated unions) to reduce `unknown` casting.
3. **ApiClient Tests:** Add unit/integration tests for retry behavior, interceptors, and error mapping.
4. **Resource Cleanup:** Add unsubscribe hooks for DataProcessor’s internal subscriptions; expose graceful shutdown.
5. **Validation Extensibility:** Allow injecting a validator instance or rules into DataProcessor.

---

## Usage & Extension Tips
- Adjust `ProcessorConfig` in `src/index.ts` or your composition root.
- Register event handlers/middleware early; use priorities for ordering.
- For HTTP integrations, configure `ApiClient` with proper base URL, headers, and retry settings.
- Set logger level via `logger.setLevel(LogLevel.DEBUG)` during debugging.

## File Map (Quick Reference)
| Module | Responsibility | Key APIs |
|--------|----------------|---------|
| `src/index.ts` | Composition/entry | `main()`
| `core/data-processor.ts` | Batch & record processing | `processBatch`, `processRecord`, `getActiveProcesses`
| `core/event-bus.ts` | Pub/Sub & middleware | `subscribe`, `publish`, `use`, `clear`
| `core/api-client.ts` | HTTP client w/ retry | `get`, `post`, `put`, `delete`
| `utils/logger.ts` | Structured logging | `setLevel`, `setContext`, `debug/info/warn/error`
| `utils/validator.ts` | Validation utilities | `validateDataRecord`, `Validator`
| `types/index.ts` | Shared contracts | `DataRecord`, `ProcessingResult`, `ProcessorConfig`, etc.

---

*Prepared by GitHub Copilot (using Raptor Secondary (Preview))*
