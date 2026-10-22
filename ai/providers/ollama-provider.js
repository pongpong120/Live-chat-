// Keyless Ollama-compatible AI provider. No API key is required.
const config = require("../ai-config");
async function generate(messages, systemPrompt) {
  const base = String(config.AI_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.AI_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.AI_MODEL, stream: false, messages: [
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }))
      ], options: { temperature: 0.3 } }), signal: controller.signal
    });
    if (!res.ok) throw new Error(`Ollama API error ${res.status}: ${(await res.text().catch(() => "")).slice(0,300)}`);
    const data = await res.json();
    const text = data?.message?.content;
    if (!text) throw new Error("Ollama returned an empty response");
    return { text, usage: { inputTokens: Number(data?.prompt_eval_count || 0), outputTokens: Number(data?.eval_count || 0) } };
  } finally { clearTimeout(timer); }
}
module.exports = { generate };
