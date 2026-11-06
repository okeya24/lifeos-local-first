import { getOllamaStatus, streamOllamaChat } from "./ollama.mjs";
import {
  getCloudStatus,
  streamCloudChat,
  isCloudConfigured
} from "./zhipu.mjs";

export const localProvider = {
  name: "ollama-local",
  label: "本地 Ollama",
  getStatus: getOllamaStatus,
  streamChat: streamOllamaChat
};

export const cloudProvider = {
  name: "zhipu-glm",
  label: "云端 GLM",
  getStatus: getCloudStatus,
  streamChat: streamCloudChat,
  available: isCloudConfigured()
};

export function isCloudAvailable() {
  return isCloudConfigured();
}

export function resolveProvider(key) {
  if (key === "cloud" && isCloudConfigured()) {
    return cloudProvider;
  }
  return localProvider;
}

// 兼容旧引用（/api/status 仍在用）
export const modelProvider = localProvider;
