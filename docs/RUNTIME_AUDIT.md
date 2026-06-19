# Runtime Audit

## Observability Sources

- Runtime registry reports currently active executions only.
- Telemetry metrics report process-lifetime counters for tasksExecuted, tasksFailed, and tasksValidated.
- Health reporting derives status from observed failures and current execution count.
- Ledger persistence remains the source of truth for completed execution records.

## Failure History

Failure-history reporting is intentionally unsupported.

Repository infrastructure does not persist runtime failure events beyond process-lifetime metrics counters. The runtime registry removes execution state on completion or failure, and no deterministic persistence mechanism exists for historical failure inspection.

Consumers should treat tasksFailed telemetry as a current-process counter rather than a durable audit log.

## Lifecycle

TaskReceived -> TaskClassified -> TaskRouted -> TaskExecuted -> TaskValidated -> TaskPersisted

Failures emit TaskFailed and do not create a persistent failure-history subsystem.
