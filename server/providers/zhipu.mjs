const baseUrl = process.env.CLOUD_API_BASE || "https://open.bigmodel.cn/api/paas/v4";
const apiKey = process.env.CLOUD_API_KEY || "";
const model = process.env.CLOUD_MODEL || "glm-4-flash";

export function isCloudConfigured() {
  return Boolean(apiKey);
}

export async function getCloudStatus() {
  return {
    online: isCloudConfigured(),
    provider: "zhipu",
    model,
    configured: isCloudConfigured()
  };
}

export async function chatOnce({ messages, tools, temperature = 0.4, signal }) {
  if (!isCloudConfigured()) {
    throw new Error("未配置 CLOUD_API_KEY");
  }

  // 不设 max_tokens 时智谱默认给 1024，长回答会被硬截断（记录里出现过"以上是近期王老师相关"就断了）
  const maxTokens = Number(process.env.CLOUD_MAX_TOKENS || 2048);
  const body = { model, messages, temperature, stream: false, max_tokens: maxTokens };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const cloudResponse = await fetch(`${baseUrl}/chat/completions`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!cloudResponse.ok) {
    const detail = await cloudResponse.text();
    throw new Error(detail || `智谱 API ${cloudResponse.status}`);
  }

  const data = await cloudResponse.json();
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("智谱 API 返回为空");
  }
  return message;
}

export async function* streamCloudChat({ messages, temperature = 0.8, signal }) {
  if (!isCloudConfigured()) {
    throw new Error("未配置 CLOUD_API_KEY");
  }

  const cloudResponse = await fetch(`${baseUrl}/chat/completions`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature,
      max_tokens: Number(process.env.CLOUD_MAX_TOKENS || 2048),
      messages
    })
  });

  if (!cloudResponse.ok) {
    const detail = await cloudResponse.text();
    throw new Error(detail || `智谱 API ${cloudResponse.status}`);
  }

  const reader = cloudResponse.body.getReader();
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
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          yield { type: "done" };
          return;
        }
        try {
          const chunk = JSON.parse(payload);
          const content = chunk.choices?.[0]?.delta?.content || "";
          if (content) yield { type: "delta", content };
        } catch {
          // 忽略无法解析的心跳/注释行
        }
      }
      newline = buffer.indexOf("\n");
    }
  }

  yield { type: "done" };
}
