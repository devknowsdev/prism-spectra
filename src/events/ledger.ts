export const prismEventTypes = [
  "workbench.opened",
  "capability.manifest.registered",
  "approval.requested",
  "approval.resolved",
  "checkpoint.created",
  "checkpoint.rollback.requested",
  "artifact.observed",
  "artifact.previewed",
  "artifact.written",
  "attachment.ingest.opened",
  "attachment.ingest.previewed",
  "attachment.ingest.cancelled",
  "attachment.ingest.completed",
  "attachment.preview.requested",
  "attachment.preview.available",
  "attachment.preview.blocked",
  "attachment.preview.failed",
  "attachment.audio.preview.opened",
  "attachment.audio.preview.ready",
  "attachment.audio.preview.closed",
  "attachment.audio.preview.failed",
  "attachment.tag.added",
  "attachment.tag.removed",
  "attachment.metadata.updated",
  "job.scheduled",
  "job.started",
  "job.progress",
  "job.completed",
  "job.cancelled",
  "job.failed",
  "system.notice",
  "system.warning",
  "system.error",
] as const;

export type PrismEventType = (typeof prismEventTypes)[number];

export const prismEventSeverities = ["info", "low", "medium", "high"] as const;
export type PrismEventSeverity = (typeof prismEventSeverities)[number];

export const prismEventSources = [
  "workbench",
  "capability",
  "approval",
  "checkpoint",
  "artifact",
  "attachment",
  "job",
  "system",
  "conversation",
] as const;
export type PrismEventSource = (typeof prismEventSources)[number];

export interface PrismEvent {
  id: string;
  time: string;
  type: PrismEventType;
  summary: string;
  severity: PrismEventSeverity;
  source: PrismEventSource;
  relatedCapabilityId?: string;
  relatedArtifactId?: string;
  relatedConversationId?: string;
  relatedCheckpointId?: number;
  relatedApprovalId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface PrismEventInput {
  id?: string;
  time?: string;
  type: PrismEventType;
  summary: string;
  severity: PrismEventSeverity;
  source: PrismEventSource;
  relatedCapabilityId?: string;
  relatedArtifactId?: string;
  relatedConversationId?: string;
  relatedCheckpointId?: number;
  relatedApprovalId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface PrismEventListOptions {
  limit?: number;
  type?: PrismEventType | PrismEventType[];
  severity?: PrismEventSeverity | PrismEventSeverity[];
  relatedCapabilityId?: string;
  relatedArtifactId?: string;
  relatedConversationId?: string;
  relatedCheckpointId?: number;
  relatedApprovalId?: string;
  sessionId?: string;
}

export interface PrismEventLedger {
  append(event: PrismEventInput): PrismEvent;
  list(options?: PrismEventListOptions): PrismEvent[];
  get(id: string): PrismEvent | undefined;
  clear(): void;
}

export type PrismEventListener = (event: PrismEvent) => void;

interface StoredPrismEvent {
  seq: number;
  event: PrismEvent;
}

function cloneEvent(event: PrismEvent): PrismEvent {
  return structuredClone(event);
}

function normalizeFilter<T extends string>(value: T | T[] | undefined): T[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value : [value];
}

function matchesFilter<T extends string>(value: T, filter: T[] | undefined): boolean {
  if (!filter) return true;
  return filter.includes(value);
}

export class InMemoryPrismEventLedger implements PrismEventLedger {
  private seq = 0;
  private readonly events: StoredPrismEvent[] = [];
  private readonly listeners = new Set<PrismEventListener>();
  private currentSessionId: string | undefined;

  constructor(options: { sessionId?: string } = {}) {
    this.currentSessionId = options.sessionId?.trim() || undefined;
  }

  setSessionId(sessionId: string | null | undefined): void {
    this.currentSessionId = sessionId?.trim() || undefined;
  }

  append(input: PrismEventInput): PrismEvent {
    const event: PrismEvent = {
      id: input.id?.trim() || `evt_${Date.now().toString(36)}_${(this.seq + 1).toString(36)}`,
      time: input.time?.trim() || new Date().toISOString(),
      type: input.type,
      summary: input.summary.trim(),
      severity: input.severity,
      source: input.source,
      relatedCapabilityId: input.relatedCapabilityId?.trim() || undefined,
      relatedArtifactId: input.relatedArtifactId?.trim() || undefined,
      relatedConversationId: input.relatedConversationId?.trim() || undefined,
      relatedCheckpointId: typeof input.relatedCheckpointId === "number" ? input.relatedCheckpointId : undefined,
      relatedApprovalId: input.relatedApprovalId?.trim() || undefined,
      sessionId: input.sessionId?.trim() || this.currentSessionId,
      metadata: input.metadata ? structuredClone(input.metadata) : undefined,
    };

    this.seq += 1;
    this.events.push({ seq: this.seq, event: cloneEvent(event) });
    const emitted = cloneEvent(event);
    for (const listener of this.listeners) {
      try {
        listener(cloneEvent(event));
      } catch {
        // Listener failures must not change ledger append semantics.
      }
    }
    return emitted;
  }

  subscribe(listener: PrismEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(options: PrismEventListOptions = {}): PrismEvent[] {
    const typeFilter = normalizeFilter(options.type);
    const severityFilter = normalizeFilter(options.severity);
    const limit = options.limit ?? Number.POSITIVE_INFINITY;

    const items = this.events
      .filter(({ event }) => {
        if (!matchesFilter(event.type, typeFilter)) return false;
        if (!matchesFilter(event.severity, severityFilter)) return false;
        if (options.relatedCapabilityId != null && event.relatedCapabilityId !== options.relatedCapabilityId) return false;
        if (options.relatedArtifactId != null && event.relatedArtifactId !== options.relatedArtifactId) return false;
        if (options.relatedConversationId != null && event.relatedConversationId !== options.relatedConversationId) return false;
        if (options.relatedCheckpointId != null && event.relatedCheckpointId !== options.relatedCheckpointId) return false;
        if (options.relatedApprovalId != null && event.relatedApprovalId !== options.relatedApprovalId) return false;
        if (options.sessionId != null && event.sessionId !== options.sessionId) return false;
        return true;
      })
      .sort((left, right) => {
        if (left.event.time === right.event.time) {
          return right.seq - left.seq;
        }
        return right.event.time.localeCompare(left.event.time);
      })
      .slice(0, limit)
      .map(({ event }) => cloneEvent(event));

    return items;
  }

  get(id: string): PrismEvent | undefined {
    const row = this.events.find((entry) => entry.event.id === id);
    return row ? cloneEvent(row.event) : undefined;
  }

  clear(): void {
    this.events.length = 0;
    this.seq = 0;
  }
}
