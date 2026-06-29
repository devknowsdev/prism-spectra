// Mock Ollama executor — used in tests and when AI_FORGE_MOCK_EXECUTORS=1.

import type { Executor, ExecutionResult, TaskPacket } from "../types.js";
import { mockPatchFor } from "./mockPatch.js";
import { selectModel } from "./ollama.js";

interface FocusMockReply {
  reply: string;
  proposedTasks: Array<{ text: string; ts: string; estimatedMins: number; note?: string; taskScope?: "day" | "project" }>;
  proposedSchedule: Array<{ start: string; end: string; text: string; estimatedMins: number; note?: string }>;
  followUpQuestion: string;
}

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
  const focusRequest = focusJsonAiRequest(packet);
  if (focusRequest) return JSON.stringify(focusMockReply(focusRequest));

  return `[ollama:mock:${model}] handled "${packet.intent}" (${packet.node_type})`;
}

function focusMockReply(request: { prompt: string; context: Record<string, unknown>; input: Record<string, unknown> }): FocusMockReply {
  const prompt = request.prompt.toLowerCase();
  const historyText = focusHistoryText(request.input).toLowerCase();
  const currentFocusState = request.input.currentFocusState && typeof request.input.currentFocusState === "object"
    ? request.input.currentFocusState as Record<string, unknown>
    : {};
  const openTaskCount = Number(currentFocusState.openTaskCount ?? currentFocusState.taskCount ?? 0);
  const isChooseFollowUp = /four task names|help choose|choose more specifically|which task|choose one/.test(historyText) && looksLikeTaskList(prompt);

  if (/overwhelm|too much|choose|prioriti[sz]e|pick one|which task/.test(prompt) || isChooseFollowUp) {
    if (isChooseFollowUp) return chooseFromTaskListReply(request.prompt);

    const countText = openTaskCount > 0 ? `I can see ${openTaskCount} open task${openTaskCount === 1 ? "" : "s"}. ` : "";
    return {
      reply: `${countText}For a low-overwhelm next move, choose the task that is easiest to start, not the most important. Give it 10 minutes and stop after the first visible step.`,
      proposedTasks: [
        {
          text: "Pick one low-friction task and do the first 10 minutes",
          ts: "",
          estimatedMins: 10,
          note: "Mock suggestion: choose the task with the clearest first action.",
          taskScope: "day",
        },
      ],
      proposedSchedule: [],
      followUpQuestion: "What are the four task names? I can help choose more specifically.",
    };
  }

  if (/break down|breakdown|tiny step|small step/.test(prompt)) {
    return {
      reply: "Here is a mock breakdown into small, low-friction steps. Keep only the steps that feel useful.",
      proposedTasks: [
        { text: "Open the task and name the desired outcome", ts: "", estimatedMins: 5, note: "Clarify what done looks like.", taskScope: "day" },
        { text: "Do one visible first step", ts: "", estimatedMins: 10, note: "No need to finish the whole thing.", taskScope: "day" },
        { text: "Decide the next step or stop", ts: "", estimatedMins: 5, note: "Close the loop gently.", taskScope: "day" },
      ],
      proposedSchedule: [],
      followUpQuestion: "",
    };
  }

  if (/plan|schedule|next 90|next hour|today/.test(prompt)) {
    return {
      reply: "Here is a gentle mock plan: start small, add a short break, then choose one follow-up block.",
      proposedTasks: [],
      proposedSchedule: [
        { start: "", end: "", text: "First tiny start", estimatedMins: 15, note: "Pick the easiest task to begin." },
        { start: "", end: "", text: "Short reset break", estimatedMins: 10, note: "Water, stretch, or step away." },
        { start: "", end: "", text: "Second gentle focus block", estimatedMins: 25, note: "Continue only if it still feels useful." },
      ],
      followUpQuestion: "",
    };
  }

  if (/what can you do|\bhelp\b|capabilit/.test(prompt)) {
    return {
      reply: "I can help you choose a next task, break vague work into smaller steps, make a gentle plan for the next block of time, and reflect on messy notes. In mock mode I only return safe test proposals; nothing changes unless you apply it.",
      proposedTasks: [],
      proposedSchedule: [],
      followUpQuestion: "",
    };
  }

  return {
    reply: "Mock mode is connected. I can help with this, but the mock assistant is only a deterministic test surface. Try asking me to choose a task, break one down, or plan the next 90 minutes.",
    proposedTasks: [],
    proposedSchedule: [],
    followUpQuestion: "",
  };
}

function chooseFromTaskListReply(rawPrompt: string): FocusMockReply {
  const lower = rawPrompt.toLowerCase();
  if (/feed (my |the )?dog/.test(lower)) {
    return {
      reply: "Start by feeding your dog. It is the clearest care task, it is time-sensitive, and finishing it should reduce background worry before you choose the next thing.",
      proposedTasks: [
        { text: "Feed the dog", ts: "", estimatedMins: 10, note: "Do this first to remove the urgent care task.", taskScope: "day" },
      ],
      proposedSchedule: [],
      followUpQuestion: "After that, do you want help choosing between dinner, guitar practice, and the garden?",
    };
  }

  return {
    reply: "Choose the task with the clearest immediate consequence first, then the shortest useful next step. In mock mode I would start with the care or deadline task before open-ended work.",
    proposedTasks: [
      { text: "Do the clearest urgent/care task first", ts: "", estimatedMins: 10, note: "Pick the task with the most immediate consequence.", taskScope: "day" },
    ],
    proposedSchedule: [],
    followUpQuestion: "",
  };
}

function looksLikeTaskList(prompt: string): boolean {
  return /\bi need to\b|,| and |\bthen\b|\btask/.test(prompt);
}

function focusHistoryText(input: Record<string, unknown>): string {
  const history = input.history;
  if (!Array.isArray(history)) return "";
  return history.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return "";
    const record = entry as Record<string, unknown>;
    return [record.role, record.content, record.text, record.reply].filter((value) => typeof value === "string").join(" ");
  }).join("\n");
}

function focusJsonAiRequest(packet: TaskPacket): { prompt: string; context: Record<string, unknown>; input: Record<string, unknown> } | null {
  const aiRequest = (packet.context as Record<string, any> | undefined)?.aiRequest;
  if (!aiRequest || typeof aiRequest !== "object") return null;

  const sourceApp = String(aiRequest.sourceApp ?? "");
  const input = aiRequest.input && typeof aiRequest.input === "object" ? aiRequest.input as Record<string, unknown> : {};
  const context = aiRequest.context && typeof aiRequest.context === "object" ? aiRequest.context as Record<string, unknown> : {};
  const instruction = String(input.instruction ?? "");

  const isFocusJson = sourceApp === "prism-focus" && (
    context.feature === "focus-chat" ||
    instruction.includes("Return ONLY valid JSON") ||
    instruction.includes("proposedTasks")
  );
  if (!isFocusJson) return null;

  return {
    prompt: String(input.prompt ?? ""),
    context,
    input,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
