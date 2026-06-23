// Mock Claude executor — used in tests and when AI_FORGE_MOCK_EXECUTORS=1.

import type { Executor, ExecutionResult, TaskPacket } from "../types.js";
import { mockPatchFor } from "./mockPatch.js";

const CLAUDE_COST_PER_1K_INPUT = 0.003;
const CLAUDE_COST_PER_1K_OUTPUT = 0.015;

export class ClaudeMockExecutor implements Executor {
  readonly name = "claude" as const;

  async execute(packet: TaskPacket): Promise<ExecutionResult> {
    const start = Date.now();
    await sleep(260 + Math.random() * 240);

    if (packet.context.simulateFailure === "claude") {
      return {
        success: false,
        output: "",
        provider: "claude",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        latencyMs: Date.now() - start,
        error: "simulated claude failure",
      };
    }

    const output = `[claude:mock] handled "${packet.intent}" (${packet.node_type})`;
    const tokensIn = estimateTokens(packet.intent);
    const tokensOut = estimateTokens(output);
    return {
      success: true,
      output,
      provider: "claude",
      tokensIn,
      tokensOut,
      cost: (tokensIn / 1000) * CLAUDE_COST_PER_1K_INPUT + (tokensOut / 1000) * CLAUDE_COST_PER_1K_OUTPUT,
      latencyMs: Date.now() - start,
      patch: mockPatchFor(packet, "claude"),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
