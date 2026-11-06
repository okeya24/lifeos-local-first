import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const vaultDir = path.join(projectRoot, "vault");

// 内部文件：人设、技能卡、说明文档、对话存档、指令模板 —— 都不是"用户的笔记"
// 以前把这些混进笔记索引，导致：①"我的笔记"清单被污染 ②检索时把偏好/人设/蒸馏指令
// 当成参考资料喂给模型（蒸馏时甚至会把指令文件当素材蒸）。这里统一收口。
// 「待蒸馏」是待处理队列，不是知识库：放进去的长文常有一两万字，一旦当资料注入，
// 每轮对话都拖着它走，又慢又容易被模型拿来瞎总结。
const INTERNAL_DIRS = new Set(["agents", ".chats", "90 归档", "待蒸馏"]);
const INTERNAL_TITLES = /^(skill|readme|user-prefs|companion|蒸馏任务记录)$/i;

export function isInternalNote(relativePath, title) {
  const raw = String(relativePath || "");
  const parts = raw.split(path.sep);
  if (parts.some((part) => INTERNAL_DIRS.has(part))) return true;
  if (raw.split("/").some((part) => INTERNAL_DIRS.has(part))) return true;
  const base = String(title || path.basename(raw))
    .replace(/\.md$/i, "")
    .trim();
  return INTERNAL_TITLES.test(base);
}

export async function walkUserNotes(directory = vaultDir) {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (INTERNAL_DIRS.has(entry.name)) continue;
      files.push(...(await walkUserNotes(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}
