import type { NodeType, TaskPacket } from "../types.js";
import type { ModelRole } from "../executors/ollama.js";

export type TaskClass = "code" | "reasoning" | "creative" | "general" | "unknown";

export interface L1Classification {
  taskClass: TaskClass;
  role: ModelRole;
  confidence: number;
  signals: string[];
}

const CODE_PATTERNS = [
  /\bfunction\b/i,
  /\bclass\b/i,
  /\bimport\b/i,
  /\bconst\b/i,
  /\blet\b/i,
  /\basync\b/i,
  /\bdef\s+\w+/i,
  /```/,
  /\bbug\b/i,
  /\brefactor\b/i,
  /\btypescript\b/i,
  /\bjavascript\b/i,
];

const REASONING_PATTERNS = [
  /\bwhy\b/i,
  /\bexplain\b/i,
  /\banaly[sz]e\b/i,
  /\bcompare\b/i,
  /\bevaluate\b/i,
  /\btrade[- ]offs?\b/i,
  /\bstep by step\b/i,
  /\bdebug\b/i,
];

const CREATIVE_PATTERNS = [
  /\bwrite a\b/i,
  /\bstory\b/i,
  /\bpoem\b/i,
  /\bimagine\b/i,
  /\bbrainstorm\b/i,
  /\bname ideas\b/i,
  /\bdraft\b/i,
];

const DATA_PATTERNS = [
  /\bcsv\b/i,
  /\bextract\b/i,
  /\bclassify\b/i,
  /\bsummarise\b/i,
  /\bsummarize\b/i,
  /\bkey figures\b/i,
  /\btable\b/i,
];

function roleForTaskClass(taskClass: TaskClass): ModelRole {
  switch (taskClass) {
    case "code":
      return "coder";
    case "reasoning":
      return "reasoner";
    case "creative":
    case "general":
      return "planner";
    case "unknown":
    default:
      return "fallback";
  }
}

function nodeTypeSignal(nodeType: NodeType): { taskClass: TaskClass; score: number; signal: string } {
  switch (nodeType) {
    case "ui":
    case "backend":
    case "tests":
      return { taskClass: "code", score: 0.6, signal: `node_type:${nodeType}` };
    case "terminal":
      return { taskClass: "reasoning", score: 0.45, signal: "node_type:terminal" };
    case "docs":
    default:
      return { taskClass: "general", score: 0.25, signal: `node_type:${nodeType}` };
  }
}

function patternScore(text: string, patterns: RegExp[], signalPrefix: string): { score: number; signals: string[] } {
  const signals: string[] = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) signals.push(`${signalPrefix}:${pattern.source}`);
  }
  return { score: Math.min(0.6, signals.length * 0.18), signals };
}

export function classifyTaskHeuristic(packet: TaskPacket): L1Classification {
  const text = `${packet.intent}\n${JSON.stringify(packet.context ?? {})}`;
  const scores: Record<TaskClass, number> = {
    code: 0,
    reasoning: 0,
    creative: 0,
    general: 0,
    unknown: 0,
  };
  const signals: string[] = [];

  const node = nodeTypeSignal(packet.node_type);
  scores[node.taskClass] += node.score;
  signals.push(node.signal);

  const code = patternScore(text, CODE_PATTERNS, "code");
  scores.code += code.score;
  signals.push(...code.signals);

  const reasoning = patternScore(text, REASONING_PATTERNS, "reasoning");
  scores.reasoning += reasoning.score;
  signals.push(...reasoning.signals);

  const creative = patternScore(text, CREATIVE_PATTERNS, "creative");
  scores.creative += creative.score;
  signals.push(...creative.signals);

  const data = patternScore(text, DATA_PATTERNS, "data");
  scores.general += data.score;
  if (data.signals.length > 0) {
    scores.reasoning += 0.12;
    signals.push(...data.signals);
  }

  const tokenEstimate = Math.ceil(text.split(/\s+/).filter(Boolean).length * 0.75);
  if (tokenEstimate > 160) {
    scores.reasoning += 0.15;
    signals.push("length:long");
  }

  let taskClass: TaskClass = "unknown";
  let bestScore = 0;
  for (const candidate of ["code", "reasoning", "creative", "general"] as TaskClass[]) {
    if (scores[candidate] > bestScore) {
      taskClass = candidate;
      bestScore = scores[candidate];
    }
  }

  const confidence = clamp(taskClass === "unknown" ? 0.2 : 0.3 + bestScore, 0.2, 0.95);
  return {
    taskClass,
    role: roleForTaskClass(taskClass),
    confidence,
    signals,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
