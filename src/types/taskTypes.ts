export type TaskType =
  | 'audio.analysis'
  | 'audio.transcription'
  | 'audio.semantic'
  | 'code'
  | 'planning'
  | 'reasoning'
  | 'retrieval'
  | 'tooling';

export interface Task {
  id: string;
  input: string;
  taskType?: TaskType;
  metadata?: Record<string, unknown>;
  timestamp: string;
}
