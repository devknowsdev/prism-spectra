export interface ExecutionRequest {
  id: string;
  input: string;
  taskType?: string;
  metadata?: Record<string, unknown>;
}

export interface RouteDecision {
  taskType: string;
  executor: string;
  confidence: number;
  plannerRequired?: boolean;
  validationRequired?: boolean;
}

export interface ExecutionResult {
  output: string;
  modelUsed: string;
  durationMs: number;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  request: ExecutionRequest;
  route: RouteDecision;
  result: ExecutionResult;
}
