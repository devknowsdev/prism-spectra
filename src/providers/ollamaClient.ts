export interface GenerationRequest {
  model: string;
  prompt: string;
  temperature?: number;
}

export interface GenerationResponse {
  output: string;
  model: string;
  durationMs: number;
}

export async function generate(request: GenerationRequest): Promise<GenerationResponse> {
  const started = Date.now();

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      stream: false,
      options: {
        temperature: request.temperature ?? 0
      }
    })
  });

  const data = await response.json();

  return {
    output: data.response,
    model: request.model,
    durationMs: Date.now() - started
  };
}
