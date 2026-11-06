const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";

export async function getOllamaStatus() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const ollamaResponse = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!ollamaResponse.ok) throw new Error(`Ollama ${ollamaResponse.status}`);
    const data = await ollamaResponse.json();
    const models = (data.models || []).map((entry) => entry.name);
    return {
      online: true,
      provider: "ollama",
      model,
      modelAvailable: models.includes(model),
      models
    };
  } catch {
    return {
      online: false,
      provider: "ollama",
      model,
      modelAvailable: false,
      models: []
    };
  }
}

export async function* streamOllamaChat({ messages, temperature = 0.7, signal }) {
  const ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      options: {
        temperature,
        num_ctx: 8192
      }
    })
  });

  if (!ollamaResponse.ok) {
    const detail = await ollamaResponse.text();
    throw new Error(detail || `Ollama ${ollamaResponse.status}`);
  }

  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const chunk = JSON.parse(line);
        const content = chunk.message?.content || "";
        if (content) yield { type: "delta", content };
        if (chunk.done) yield { type: "done" };
      }
      newline = buffer.indexOf("\n");
    }
  }
}
