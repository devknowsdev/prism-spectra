import { ollamaHost } from "../executors/ollama.js";

export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
export const DEFAULT_EMBEDDING_KEEPALIVE = "5m";

export interface EmbeddingProvider {
  embed(input: string): Promise<number[] | null>;
  keepAlive?(): Promise<void>;
  close?(): void;
}

export interface OllamaEmbeddingProviderOptions {
  host?: string;
  model?: string;
  keepAlive?: string;
  timeoutMs?: number;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private host: string;
  private model: string;
  private keepAliveValue: string;
  private timeoutMs: number;

  constructor(opts: OllamaEmbeddingProviderOptions = {}) {
    this.host = (opts.host ?? ollamaHost()).replace(/\/$/, "");
    this.model = opts.model ?? process.env.OLLAMA_EMBED_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    this.keepAliveValue = opts.keepAlive ?? process.env.OLLAMA_EMBED_KEEP_ALIVE ?? DEFAULT_EMBEDDING_KEEPALIVE;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async embed(input: string): Promise<number[] | null> {
    const text = input.trim();
    if (!text) return null;
    try {
      const response = await fetch(`${this.host}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: text,
          truncate: true,
          keep_alive: this.keepAliveValue,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { embeddings?: unknown };
      const first = Array.isArray(data.embeddings) ? data.embeddings[0] : null;
      if (!Array.isArray(first) || first.length === 0) return null;
      const vector = first.map((value) => Number(value));
      return vector.every(Number.isFinite) ? vector : null;
    } catch {
      return null;
    }
  }

  async keepAlive(): Promise<void> {
    await this.embed("spectra semantic cache keepalive");
  }
}

export function startEmbeddingKeepalive(
  provider: EmbeddingProvider,
  intervalMs = Number(process.env.SPECTRA_EMBED_KEEPALIVE_MS ?? 180_000),
): { stop: () => void } {
  if (!provider.keepAlive || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { stop: () => {} };
  }

  const timer = setInterval(() => {
    provider.keepAlive?.().catch(() => {
      // Embedding keepalive is advisory. Failures must not crash the daemon or engine.
    });
  }, intervalMs);

  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
