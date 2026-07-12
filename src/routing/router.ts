import type { ExecutorName, NodeType, TaskPacket } from "../types.js";
import type { Ledger } from "../memory/ledger.js";
import type { LearningLoop } from "../intelligence/learningLoop.js";
import type { RouteDecisionHint } from "./routeDecisionCache.js";

export interface ChainAttempt {
  provider: ExecutorName;
  allowed: boolean;
  reason?: string;
}

export interface RouteDecision {
  executor: ExecutorName | null;
  chainTried: ChainAttempt[];
  routeCacheHit?: boolean;
  routeCacheSimilarity?: number;
}

export type Complexity = "low" | "medium" | "high";

export interface ProviderAvailability {
  available: boolean;
  reason?: string;
}

const HIGH_COMPLEXITY_TYPES: ReadonlySet<NodeType> = new Set(["backend", "tests"]);
const LOW_COMPLEXITY_TYPES: ReadonlySet<NodeType> = new Set(["docs"]);

export function classifyComplexity(packet: TaskPacket): Complexity {
  if (HIGH_COMPLEXITY_TYPES.has(packet.node_type)) return "high";
  if (LOW_COMPLEXITY_TYPES.has(packet.node_type)) return "low";
  return "medium";
}

function paidTierPreference(complexity: Complexity, routeHint?: RouteDecisionHint | null): ExecutorName[] {
  const cached = routeHint?.paidProviderPreference;
  if (cached === "gpt") return ["gpt", "claude"];
  if (cached === "claude") return ["claude", "gpt"];
  return complexity === "high" ? ["claude", "gpt"] : ["gpt", "claude"];
}

function preferredMode(packet: TaskPacket): string | undefined {
  const aiRequest = packet.context?.aiRequest;
  if (!aiRequest || typeof aiRequest !== "object") return undefined;
  const value = (aiRequest as Record<string, unknown>).preferredMode;
  return typeof value === "string" ? value : undefined;
}

export class Router {
  private providerAvailability: Partial<Record<ExecutorName, ProviderAvailability>> = {};

  constructor(private ledger: Ledger, private learningLoop: LearningLoop) {}

  setProviderAvailability(provider: ExecutorName, status: ProviderAvailability): void {
    this.providerAvailability[provider] = status;
  }

  private providerAvailable(provider: ExecutorName): ProviderAvailability {
    return this.providerAvailability[provider] ?? { available: true };
  }

  private localTierAvailable(_packet: TaskPacket): ProviderAvailability {
    return this.providerAvailable("ollama");
  }

  route(packet: TaskPacket, exclude: ExecutorName[] = [], routeHint?: RouteDecisionHint | null): RouteDecision {
    if (packet.node_type === "terminal") {
      return { executor: "terminal", chainTried: [{ provider: "terminal", allowed: true }] };
    }

    const chainTried: ChainAttempt[] = [];
    const excludeSet = new Set(exclude);
    const routeCacheMeta = routeHint?.hit ? { routeCacheHit: true, routeCacheSimilarity: routeHint.similarity } : {};

    if (!excludeSet.has("ollama")) {
      const localStatus = this.localTierAvailable(packet);
      if (!localStatus.available) {
        chainTried.push({ provider: "ollama", allowed: false, reason: localStatus.reason ?? "provider unavailable" });
      } else {
        const check = this.ledger.check("ollama");
        chainTried.push({ provider: "ollama", allowed: check.allowed, reason: check.reason });
        if (check.allowed) return { executor: "ollama", chainTried, ...routeCacheMeta };
      }
    }

    if (preferredMode(packet) === "local-only") {
      return { executor: null, chainTried, ...routeCacheMeta };
    }

    if (!excludeSet.has("free_tier")) {
      const status = this.providerAvailable("free_tier");
      if (!status.available) {
        chainTried.push({ provider: "free_tier", allowed: false, reason: status.reason ?? "provider unavailable" });
      } else {
        const check = this.ledger.check("free_tier");
        chainTried.push({ provider: "free_tier", allowed: check.allowed, reason: check.reason });
        if (check.allowed) return { executor: "free_tier", chainTried, ...routeCacheMeta };
      }
    }

    const complexity = classifyComplexity(packet);
    const preferred = paidTierPreference(complexity, routeHint).filter((provider) => !excludeSet.has(provider));
    const ranked = this.learningLoop.rank(preferred, packet.node_type).map((weight) => weight.provider);

    for (const provider of ranked) {
      const status = this.providerAvailable(provider);
      if (!status.available) {
        chainTried.push({ provider, allowed: false, reason: status.reason ?? "provider unavailable" });
        continue;
      }
      const check = this.ledger.check(provider);
      chainTried.push({ provider, allowed: check.allowed, reason: check.reason });
      if (check.allowed) return { executor: provider, chainTried, ...routeCacheMeta };
    }

    return { executor: null, chainTried, ...routeCacheMeta };
  }
}
