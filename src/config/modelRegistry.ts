export type ModelId =
  | 'phi3'
  | 'llama'
  | 'qwen'
  | 'mistral'
  | 'deepseek-coder';

export interface ModelDefinition {
  id: ModelId;
  ollamaModel: string;
  maxContext: number;
  role: 'classifier' | 'planner' | 'reasoner' | 'coder' | 'fallback';
}

export const MODEL_REGISTRY: Record<ModelId, ModelDefinition> = {
  phi3: { id: 'phi3', ollamaModel: 'phi3:mini', maxContext: 4096, role: 'classifier' },
  qwen: { id: 'qwen', ollamaModel: 'qwen2.5:7b', maxContext: 8192, role: 'planner' },
  llama: { id: 'llama', ollamaModel: 'llama3.1:8b', maxContext: 8192, role: 'reasoner' },
  mistral: { id: 'mistral', ollamaModel: 'mistral:7b', maxContext: 8192, role: 'fallback' },
  'deepseek-coder': { id: 'deepseek-coder', ollamaModel: 'deepseek-coder:6.7b', maxContext: 8192, role: 'coder' }
};
