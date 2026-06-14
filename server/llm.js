import OpenAI from "openai";

const provider = process.env.AI_PROVIDER ?? "local";
const openaiModel = process.env.OPENAI_AGENT_MODEL ?? process.env.AI_MODEL ?? "gpt-5.5";
const genericModel = process.env.AI_MODEL ?? "openrouter/free";
const ollamaModel = process.env.OLLAMA_MODEL ?? process.env.AI_MODEL ?? "qwen2.5:7b";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const compatibleClient =
  process.env.AI_BASE_URL && process.env.AI_API_KEY
    ? new OpenAI({
        apiKey: process.env.AI_API_KEY,
        baseURL: process.env.AI_BASE_URL
      })
    : null;

function publicProviderError(error) {
  const message = String(error.message ?? error);
  if (/api key|unauthorized|authentication|401/i.test(message)) return "model_auth_failed";
  return message
    .replace(/sk-[A-Za-z0-9_*.-]+/g, "[REDACTED_SECRET]")
    .replace(/[A-Za-z0-9_-]{4}\*{4,}[A-Za-z0-9_-]{3,}/g, "[REDACTED_SECRET]")
    .slice(0, 180);
}

async function completeWithOllama(prompt, json) {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      format: json ? "json" : undefined
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.message?.content ?? null;
}

async function completeWithOpenAI(client, model, prompt) {
  if (!client) return null;
  const response = await client.responses.create({ model, input: prompt });
  if (response.output_text) return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
}

export async function completeTextResult(prompt, options = {}) {
  const startedAt = Date.now();
  try {
    if (provider === "local") {
      return { ok: true, text: null, provider, durationMs: Date.now() - startedAt };
    }
    let text = null;
    if (provider === "ollama") text = await completeWithOllama(prompt, options.json);
    if (provider === "openai-compatible") text = await completeWithOpenAI(compatibleClient, genericModel, prompt);
    if (provider === "openai") text = await completeWithOpenAI(openaiClient, openaiModel, prompt);
    if (text) {
      return { ok: true, text, provider, durationMs: Date.now() - startedAt };
    }
    return { ok: false, text: null, provider, error: "no_model_response", durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      text: null,
      provider,
      error: publicProviderError(error),
      durationMs: Date.now() - startedAt
    };
  }
}

export async function completeText(prompt, options = {}) {
  const result = await completeTextResult(prompt, options);
  return result.text;
}

export function getTextProvider() {
  return provider;
}
