import { RuntimeState, ExecutionStatus } from './state';
import type { ExecutionRequest, RouteDecision, ExecutionResult } from '../types/contracts';

export interface ExecutionContext {
  executionId: string;
  request: ExecutionRequest;
  state: RuntimeState;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  route?: RouteDecision;
  result?: ExecutionResult;
  error?: string;
}
