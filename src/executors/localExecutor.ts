import { MODEL_REGISTRY, type ModelId } from '../config/modelRegistry';
import { generate } from '../providers/ollamaClient';

export async function executeModel(modelId: ModelId, prompt: string) {
  const model = MODEL_REGISTRY[modelId];

  return generate({
    model: model.ollamaModel,
    prompt,
    temperature: 0
  });
}
