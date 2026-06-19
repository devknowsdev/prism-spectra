import type { TaskType } from '../types/taskTypes';
import type { ModelId } from '../config/modelRegistry';

export interface RouteDecision {
  taskType: TaskType;
  executor: ModelId;
  plannerRequired: boolean;
  validationRequired: boolean;
  confidence: number;
}
