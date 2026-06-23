// Mock terminal executor — used when AI_FORGE_MOCK_EXECUTORS=1.
// It never shells out; it just records the intent.

import type { Executor, ExecutionResult, TaskPacket } from "../types.js";

export class TerminalMockExecutor implements Executor {
  readonly name = "terminal" as const;

  async execute(packet: TaskPacket): Promise<ExecutionResult> {
    const start = Date.now();
    return {
      success: false,
      output: `[terminal:mock] blocked "${packet.intent}"`,
      provider: "terminal",
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      latencyMs: Date.now() - start,
      error: "terminal execution disabled in mock mode",
    };
  }
}
