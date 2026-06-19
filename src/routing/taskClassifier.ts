import { z } from 'zod';
import { generate } from '../providers/ollamaClient';
import { MODEL_REGISTRY } from '../config/modelRegistry';
import type { TaskType } from '../types/taskTypes';

const ClassificationSchema = z.object({
  taskType: z.enum([
    'audio.analysis',
    'audio.transcription',
    'audio.semantic',
    'code',
    'planning',
    'reasoning',
    'retrieval',
    'tooling'
  ]),
  confidence: z.number().min(0).max(1)
});

export interface ClassificationResult {
  taskType: TaskType;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a task classifier. Return JSON only.`;

export async function classifyTask(input: string): Promise<ClassificationResult> {
  try {
    const response = await generate({
      model: MODEL_REGISTRY.phi3.ollamaModel,
      prompt: `${SYSTEM_PROMPT}\n\nTask:\n${input}`,
      temperature: 0
    });

    return ClassificationSchema.parse(JSON.parse(response.output));
  } catch {
    return { taskType: 'reasoning', confidence: 0.25 };
  }
}
