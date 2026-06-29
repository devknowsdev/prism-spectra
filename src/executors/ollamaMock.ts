// Mock Ollama executor — used in tests and when AI_FORGE_MOCK_EXECUTORS=1.

import type { Executor, ExecutionResult, TaskPacket } from "../types.js";
import { mockPatchFor } from "./mockPatch.js";
import { selectModel } from "./ollama.js";

export class OllamaMockExecutor implements Executor {
  readonly name = "ollama" as const;

  async execute(packet: TaskPacket): Promise<ExecutionResult> {
    const start = Date.now();
    const model = selectModel(packet);
    await sleep(40 + Math.random() * 60);

    if (packet.context.simulateFailure === "ollama") {
      return {
        success: false,
        output: "",
        provider: "ollama",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        latencyMs: Date.now() - start,
        error: "simulated local model failure",
      };
    }

    const output = mockOutputFor(packet, model);
    return {
      success: true,
      output,
      provider: "ollama",
      tokensIn: estimateTokens(packet.intent),
      tokensOut: estimateTokens(output),
      cost: 0,
      latencyMs: Date.now() - start,
      patch: mockPatchFor(packet, "ollama"),
    };
  }
}

function mockOutputFor(packet: TaskPacket, model: string): string {
  if (isFocusJsonAiRequest(packet)) {
    return JSON.stringify({
      reply: "Mock mode is connected. I can help you break down tasks, prioritise your day, plan gentle schedule blocks, and reflect on notes without changing anything until you apply it.",
      proposedTasks: [],
      proposedSchedule: [],
      followUpQuestion: "",
    });
  }

  return `[ollama:mock:${model}] handled "${packet.intent}" (${packet.node_type})`;
}

function isFocusJsonAiRequest(packet: TaskPacket): boolean {
  const aiRequest = (packet.context as Record<string, any> | undefined)?.aiRequest;
  if (!aiRequest || typeof aiRequest !== "object") return false;

  const sourceApp = String(aiRequest.sourceApp ?? "");
  const input = aiRequest.input && typeof aiRequest.input === "object" ? aiRequest.input as Record<string, unknown> : {};
  const context = aiRequest.context && typeof aiRequest.context === "object" ? aiRequest.context as Record<string, unknown> : {};
  const instruction = String(input.instruction ?? "");

  return sourceApp === "prism-focus" && (
    context.feature === "focus-chat" ||
    instruction.includes("Return ONLY valid JSON") ||
    instruction.includes("proposedTasks")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
