export const CLOUD_TEACHER_PROVIDERS = ["anthropic", "openai"] as const;
export type CloudTeacherProvider = (typeof CLOUD_TEACHER_PROVIDERS)[number];
export type CloudTeacherRole = "teacher" | "judge" | "persona-driver";
export type CloudTeacherMessageRole = "system" | "user" | "assistant";

export const DEFAULT_CLOUD_TEACHER_COST_CEILING_USD = 2;

export interface CloudTeacherMessage {
  role: CloudTeacherMessageRole;
  content: string;
}

export interface CloudTeacherChatRequest {
  provider: CloudTeacherProvider;
  role: CloudTeacherRole;
  messages: CloudTeacherMessage[];
  model?: string;
  maxOutputTokens?: number;
  costCeilingUsd?: number;
}

export interface CloudTeacherChatOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "info">;
  timeoutMs?: number;
}

export interface CloudTeacherChatResult {
  provider: CloudTeacherProvider;
  model: string;
  role: CloudTeacherRole;
  content: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  estimatedCostUsd: number;
}

export interface CloudTeacherHealthResult {
  provider: CloudTeacherProvider;
  ok: boolean;
  keyPresent: boolean;
  authOk: boolean;
  status: "ok" | "missing-key" | "auth-failed";
  reason?: string;
}

export function requiredEnvVarForCloudTeacherProvider(provider: CloudTeacherProvider): "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" {
  return configForProvider(provider).envVar;
}

interface ProviderConfig {
  provider: CloudTeacherProvider;
  envVar: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";
  defaultModel: string;
  chatUrl: string;
  healthUrl: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const PROVIDER_CONFIGS: Record<CloudTeacherProvider, ProviderConfig> = {
  anthropic: {
    provider: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5",
    chatUrl: "https://api.anthropic.com/v1/messages",
    healthUrl: "https://api.anthropic.com/v1/models",
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
  openai: {
    provider: "openai",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4.1-mini",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    healthUrl: "https://api.openai.com/v1/models",
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 1.6,
  },
};

export async function dispatchCloudTeacherChatCompletion(
  request: CloudTeacherChatRequest,
  options: CloudTeacherChatOptions = {},
): Promise<CloudTeacherChatResult> {
  const config = configForProvider(request.provider);
  const env = options.env ?? process.env;
  const apiKey = env[config.envVar]?.trim();
  if (!apiKey) {
    throw new Error(`${config.envVar} is required for explicit ${request.provider} cloud-teacher dispatch`);
  }

  if (request.messages.length === 0) {
    throw new Error("cloud-teacher dispatch requires at least one message");
  }

  const maxOutputTokens = request.maxOutputTokens ?? 1024;
  const model = request.model ?? config.defaultModel;
  const estimate = estimateCloudTeacherCost(request.messages, maxOutputTokens, config);
  const ceilingUsd = request.costCeilingUsd ?? DEFAULT_CLOUD_TEACHER_COST_CEILING_USD;
  const logger = options.logger ?? console;
  logger.info(
    `[cloud-teacher] ${request.provider}/${model} role=${request.role} estimated tokens in=${estimate.tokensIn} out<=${estimate.tokensOut} cost=$${estimate.costUsd.toFixed(4)} ceiling=$${ceilingUsd.toFixed(2)}`,
  );

  if (estimate.costUsd > ceilingUsd) {
    throw new Error(`cloud-teacher cost estimate $${estimate.costUsd.toFixed(4)} exceeds per-run ceiling $${ceilingUsd.toFixed(2)}`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(config.chatUrl, {
    method: "POST",
    headers: chatHeaders(config, apiKey),
    body: JSON.stringify(chatBody(config, request.messages, model, maxOutputTokens)),
    signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${request.provider} cloud-teacher API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const parsed = parseChatResponse(config, data);
  return {
    provider: request.provider,
    model,
    role: request.role,
    content: parsed.content,
    tokensIn: parsed.tokensIn ?? estimate.tokensIn,
    tokensOut: parsed.tokensOut ?? estimate.tokensOut,
    costUsd: costFromTokens(parsed.tokensIn ?? estimate.tokensIn, parsed.tokensOut ?? estimate.tokensOut, config),
    estimatedCostUsd: estimate.costUsd,
  };
}

export async function checkCloudTeacherHealth(
  provider: CloudTeacherProvider,
  options: Omit<CloudTeacherChatOptions, "logger"> = {},
): Promise<CloudTeacherHealthResult> {
  const config = configForProvider(provider);
  const env = options.env ?? process.env;
  const apiKey = env[config.envVar]?.trim();
  if (!apiKey) {
    return {
      provider,
      ok: false,
      keyPresent: false,
      authOk: false,
      status: "missing-key",
      reason: `${config.envVar} not set`,
    };
  }

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(config.healthUrl, {
      method: "GET",
      headers: authHeaders(config, apiKey),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!response.ok) {
      return {
        provider,
        ok: false,
        keyPresent: true,
        authOk: false,
        status: "auth-failed",
        reason: `auth ping returned HTTP ${response.status}`,
      };
    }
    return { provider, ok: true, keyPresent: true, authOk: true, status: "ok" };
  } catch (error) {
    return {
      provider,
      ok: false,
      keyPresent: true,
      authOk: false,
      status: "auth-failed",
      reason: (error as Error).message,
    };
  }
}

export async function checkAllCloudTeacherHealth(
  options: Omit<CloudTeacherChatOptions, "logger"> = {},
): Promise<CloudTeacherHealthResult[]> {
  return Promise.all(CLOUD_TEACHER_PROVIDERS.map((provider) => checkCloudTeacherHealth(provider, options)));
}

export function estimateCloudTeacherCost(
  messages: CloudTeacherMessage[],
  maxOutputTokens: number,
  provider: CloudTeacherProvider | ProviderConfig,
): { tokensIn: number; tokensOut: number; costUsd: number } {
  const config = typeof provider === "string" ? configForProvider(provider) : provider;
  const tokensIn = Math.max(1, messages.reduce((sum, message) => sum + estimateTokens(message.content), 0));
  const tokensOut = Math.max(1, maxOutputTokens);
  return {
    tokensIn,
    tokensOut,
    costUsd: costFromTokens(tokensIn, tokensOut, config),
  };
}

function configForProvider(provider: CloudTeacherProvider): ProviderConfig {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`unsupported cloud-teacher provider: ${provider}`);
  return config;
}

function chatHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...authHeaders(config, apiKey),
  };
}

function authHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  if (config.provider === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

function chatBody(config: ProviderConfig, messages: CloudTeacherMessage[], model: string, maxOutputTokens: number): unknown {
  if (config.provider === "anthropic") {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n") || undefined;
    const nonSystemMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));
    return {
      model,
      max_tokens: maxOutputTokens,
      ...(system ? { system } : {}),
      messages: nonSystemMessages.length > 0 ? nonSystemMessages : [{ role: "user", content: "" }],
    };
  }

  return {
    model,
    max_tokens: maxOutputTokens,
    messages,
  };
}

function parseChatResponse(config: ProviderConfig, data: unknown): { content: string; tokensIn?: number; tokensOut?: number } {
  const body = data as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    content?: Array<{ type?: string; text?: string }>;
  };

  if (config.provider === "anthropic") {
    return {
      content: (body.content ?? []).filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\n"),
      tokensIn: (body.usage as { input_tokens?: number } | undefined)?.input_tokens,
      tokensOut: (body.usage as { output_tokens?: number } | undefined)?.output_tokens,
    };
  }

  return {
    content: body.choices?.[0]?.message?.content ?? "",
    tokensIn: body.usage?.prompt_tokens,
    tokensOut: body.usage?.completion_tokens,
  };
}

function costFromTokens(tokensIn: number, tokensOut: number, config: ProviderConfig): number {
  return (tokensIn / 1_000_000) * config.inputPerMillionUsd + (tokensOut / 1_000_000) * config.outputPerMillionUsd;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
