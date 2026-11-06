import "./loadEnv.mjs";
import express from "express";
import {readExternalActivity} from "./externalActivity.mjs";
import {listJobs as listDistillJobs} from "./distillWorkflow.mjs";
import {growthReport} from "./growth.mjs";
import {installProgressApi,readProgress} from "./progressApi.mjs";
import { taskContext } from "./taskContext.mjs";
import { installManagement } from "./management.mjs";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  modelProvider,
  localProvider,
  cloudProvider,
  resolveProvider,
  isCloudAvailable
} from "./providers/index.mjs";
import {
  loadSkillReferences,
  loadPersona,
  loadPrefs,
  buildSystemPrompt,
  listSkills,
  buildSkillsIndex,
  matchSkill,
  appendPrefs
} from "./persona.mjs";
import { runAgentLoop, activity, countTask, beginActivity, endActivity } from "./agent.mjs";
import { runDistill, summarizeMaterial } from "./distill.mjs";
import {
  pendingPlanCount,
  executeFileOpsTool,
  fetchPageTool,
  downloadUrlTool,
  webSearchTool,
  extractFirstUrl
} from "./tools.mjs";
import { walkUserNotes, isInternalNote } from "./vaultNotes.mjs";
import { chatOnce } from "./providers/zhipu.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const vaultDir = path.join(projectRoot, "vault");
const dataFile = path.join(projectRoot, "data", "seed.json");
const distDir = path.join(projectRoot, "dist");
const port = Number(process.env.PORT || 8787);
const whisperUrl = process.env.WHISPER_URL || "http://127.0.0.1:50060";
const whisperLanguage = process.env.WHISPER_LANGUAGE || "zh";
const ffmpegPath = process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";

// 语音：判断这段录音到底有没有人声。whisper 对静音/环境噪声会"幻觉"出字幕，
// 以前会把"（字幕製作:貝爾）"当成用户说的话发出去。
function wavRms(buffer) {
  try {
    let offset = 12;
    let dataStart = -1;
    let dataLength = 0;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString("ascii", offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === "data") {
        dataStart = offset + 8;
        dataLength = Math.min(size, buffer.length - dataStart);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (dataStart < 0 || dataLength < 2) return 0;
    let sum = 0;
    let count = 0;
    for (let i = dataStart; i + 1 < dataStart + dataLength; i += 2) {
      const sample = buffer.readInt16LE(i) / 32768;
      sum += sample * sample;
      count += 1;
    }
    return count ? Math.sqrt(sum / count) : 0;
  } catch {
    return 0;
  }
}

const WHISPER_ECHO = /(字幕由|字幕製作|字幕制作|字幕提供|Amara|请不吝点赞|訂閱|订阅|Thanks for watching|下期再见)/i;

const domainFolders = {
  learning: "40 学习",
  work: "50 工作与项目",
  body: "20 身体",
  mind: "30 认知",
  life: "10 每日",
  future: "70 方向与愿景"
};

const CLOUD_HINTS =
  /(帮我设计|设计方案|分析一下|怎么办|为什么|对比一下|规划|策略|优化|整理一下|头脑风暴|灵感|复盘|润色|改写|翻译|出主意|建议怎么)/;
const LOCAL_HINTS =
  /(我的(笔记|记录|资料|项目|日记)|笔记里|资料里|复习|上次(记|说|写)|之前记|翻一下|查一下我|我记过|我写过)/;
const SEARCH_HINTS =
  /(最新|最近|近期|这两天|今年|目前|现在(有什么|怎么样|什么情况|多少)|今天(有什么|有啥|有什么事|发生|的新闻|的行情)|动态|近况|发了什么|发了啥|流传|热点|消息|进展|搜一下|搜索|网上|联网|天气|价格|行情|版本|发布|走势|评价|找找|帮我找|搜寻)/;
// 说"今天有点累""最近好烦"不是在问时事，别拿去联网搜（以前会把"今天有点累"当成"今天有什么"去搜）
const SELF_STATE = /(累|困|烦|难受|不开心|焦虑|崩溃|失眠|睡不着|emo|丧|没劲|不想干)/;
// "找找我的笔记/文件"是本地活，别拿去联网
const LOCAL_OBJECT = /(我的|笔记|文件|电脑|桌面|下载|资料库|vault|文件夹)/;
// 需要真工具才能答好的问句（查资料/扫文件/读网页/下载），统一判定，避免再出现
// "问它我的笔记却回你一句'可能已经整理过'"
const TOOL_INTENT = new RegExp(
  "列出|有哪些|哪些笔记|扫一下|扫描|大文件|占空间|读一下|读读|看看这个|看看这|这个页面|这篇文章|这个链接|写个笔记|记一下|记一条|记个|帮我记|整理|移动|改名|重命名|归档|下载|存下来|网页|链接|查一下|查查|帮我查|搜搜|找一下|了解一下|" +
    SEARCH_HINTS.source.slice(1, -1)
);
const DISTILL_HINTS =
  /(蒸馏|蒸一下|蒸成|蒸个|拆解.*书|变成技能|做成技能|做成方法卡|技能卡|提炼.*(方法|技能|套路)|提取.*(方法论|方法))/;

// ---------- 蒸馏 / 查库 意图判定 ----------
// 血泪教训：以前只要句子里出现"蒸馏"两个字就当蒸馏任务。用户问
// "帮我看一下，蒸馏库是不是有一个新的文档"时，服务端直接把待蒸馏里最新那篇
// 又蒸了一遍，回他一句"蒸馏完成"，答非所问，还凭空多出两个重复技能。
// 判据：先把"蒸馏库/待蒸馏/技能库"这些名词抠掉，剩下的"蒸馏"才是动词。
const DISTILL_VERB =
  /(蒸一下|蒸一蒸|蒸吧|蒸成|蒸出|蒸馏成|蒸馏一下|蒸馏这|蒸馏它|帮我蒸|再蒸|重蒸|重新蒸|继续蒸|拆书|变成技能|做成技能|做成方法卡|技能卡|提炼.*(方法|技能|套路)|提取.*(方法论|方法))/;
const LIBRARY_WORDS =
  /(蒸馏库|待蒸馏|技能库|技能清单|技能目录|skills|几个技能|哪些技能|装了什么技能)/i;
const LOOKUP_WORDS =
  /(是不是|有没有|有吗|有什么|什么|有哪些|哪个|几个|几篇|多少|列出|列一下|清单|确认|看看|看一下|查一下|在不在|存了|保存了|存进去|到了|内容|里面)/;

function isLibraryQuery(text) {
  const raw = String(text || "");
  return (
    LIBRARY_WORDS.test(raw) &&
    LOOKUP_WORDS.test(raw) &&
    !DISTILL_VERB.test(raw.replace(/蒸馏库|待蒸馏|技能库/g, " "))
  );
}

function isDistillRequest(text) {
  const raw = String(text || "");
  if (isLibraryQuery(raw)) return false;
  // 名词先抠掉，剩下的"蒸馏"才算动词
  const body = raw.replace(/蒸馏库|待蒸馏|技能库/g, " ");
  return DISTILL_VERB.test(body) || /蒸馏/.test(body);
}

// ---------- 蒸馏库查询（确定性回答，不经过模型） ----------
// 用户问"蒸馏库里有没有那个文档"，本质是一次查目录。交给模型答，它要么编、
// 要么绕回"我能帮你蒸馏"，所以这里直接读盘列表，答得死板但一定对。
const DISTILLED_FILE = path.join(vaultDir, ".distilled.json");

async function readDistilledLog() {
  try {
    return JSON.parse(await fs.readFile(DISTILLED_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function markDistilled(hash, info) {
  if (!hash) return;
  const all = await readDistilledLog();
  all[hash] = { ...info, at: new Date().toISOString() };
  await fs.writeFile(DISTILLED_FILE, JSON.stringify(all, null, 1), "utf8");
}

function materialHash(text) {
  return crypto
    .createHash("sha1")
    .update(String(text || "").replace(/\s+/g, "").slice(0, 20000))
    .digest("hex")
    .slice(0, 16);
}

async function listPendingMaterials() {
  const dir = path.join(vaultDir, "待蒸馏");
  const files = [];
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
        const stat = await fs.stat(full);
        files.push({
          full,
          rel: path.relative(vaultDir, full),
          name: path.basename(entry.name, ".md"),
          size: stat.size,
          mtime: stat.mtimeMs
        });
      }
    }
  };
  await walk(dir);
  return files.sort((a, b) => b.mtime - a.mtime);
}

function shortTime(ms) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(ms));
}

async function describeLibrary(text) {
  const files = await listPendingMaterials();
  const skills = await listSkills();
  const log = await readDistilledLog();
  const distilledTitles = new Map(
    Object.values(log).map((item) => [String(item.title || ""), item])
  );
  const lines = [];
  // 问到具体文件名时，把命中那篇单独点出来，别让用户自己在列表里找
  const asked = files.find((file) => text.includes(file.name.slice(0, 12)));
  if (!files.length) {
    lines.push("蒸馏库现在是空的（`vault/待蒸馏/` 里只有说明文件）。");
  } else {
    lines.push(`蒸馏库（\`vault/待蒸馏/\`）里现在有 ${files.length} 篇：`);
    for (const [index, file] of files.entries()) {
      const body = await fs.readFile(file.full, "utf8").catch(() => "");
      const chars = body.replace(/\s+/g, "").length;
      const done = distilledTitles.get(file.name);
      const state = done ? `已蒸过 → 技能「${done.skill || done.folder}」` : "还没蒸过";
      lines.push(
        `${index + 1}. **${file.name}.md** — ${chars} 字，${shortTime(file.mtime)} 存进来，${state}`
      );
    }
  }
  if (asked) {
    lines.push("");
    lines.push(`你说的应该是「${asked.name}」，${shortTime(asked.mtime)} 存的那篇。`);
  }
  lines.push("");
  lines.push(
    skills.length
      ? `技能库里现有 ${skills.length} 个技能：${skills.map((s) => s.name).join("、")}。`
      : "技能库现在是空的。"
  );
  lines.push("要蒸哪篇，说「蒸《文件名》」或者「蒸一下」；想重蒸就说「重蒸」。");
  return lines.join("\n");
}

function routeMessage(message) {
  const text = message.trim();
  let key = null;
  let clean = text;

  const forceCloud = text.match(/^@(云|强|deep)\s*/i);
  const forceLocal = text.match(/^@本\s*/);
  if (forceCloud) {
    key = "cloud";
    clean = text.slice(forceCloud[0].length);
  } else if (forceLocal) {
    key = "local";
    clean = text.slice(forceLocal[0].length);
  } else if (LOCAL_HINTS.test(text)) {
    key = "local";
  } else if (CLOUD_HINTS.test(text)) {
    key = "cloud";
  }

  if (!key) {
    key = isCloudAvailable() ? "cloud" : "local";
  }
  return { key, text: clean };
}

const app = express();
app.use(express.json({ limit: "1mb" }));
installManagement(app);
installProgressApi(app);

// —— 对话存档：每轮问答落盘，刷新/重启不丢，也方便事后复盘 ——
const chatsDir = path.join(vaultDir, ".chats");
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}
async function appendChat(entry) {
  try {
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.appendFile(
      path.join(chatsDir, `${todayKey()}.jsonl`),
      JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n",
      "utf8"
    );
  } catch (error) {
    console.error(`[对话存档] 写入失败：${error.message}`);
  }
}

app.get("/api/history/dates", async (_request, response) => {
  try {
    const files = await fs.readdir(chatsDir);
    const days = [];
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const day = name.replace(/\.jsonl$/, "");
      const raw = await fs.readFile(path.join(chatsDir, name), "utf8").catch(() => "");
      const count = raw.split("\n").filter(Boolean).length;
      if (count) days.push({ date: day, count });
    }
    days.sort((a, b) => b.date.localeCompare(a.date));
    response.json({ days });
  } catch {
    response.json({ days: [] });
  }
});

app.get("/api/history", async (request, response) => {
  const day = String(request.query.date || todayKey());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return response.status(400).json({ error: "日期格式应为 YYYY-MM-DD" });
  }
  try {
    const raw = await fs.readFile(path.join(chatsDir, `${day}.jsonl`), "utf8");
    const messages = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((item) => !request.query.sessionId || item.sessionId === request.query.sessionId)
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map((item) => ({ role: item.role, content: String(item.content || ""), time: item.time }));
    response.json({ date: day, count: messages.length, messages });
  } catch {
    response.json({ date: day, count: 0, messages: [] });
  }
});

// —— 记忆自动沉淀：每 6 轮对话提取一次长期信息写回 user-prefs.md ——
// 之前的问题：只看用户单方发言、计数在内存(重启归零)、追加不去重 → 沉淀出一堆重复又空泛的条目
const SEDIMENT_FILE = path.join(vaultDir, ".sediment.json");
const recentTurns = [];
let chatCount = 0;
try {
  const saved = JSON.parse(await fs.readFile(SEDIMENT_FILE, "utf8"));
  chatCount = Number(saved?.count) || 0;
} catch {
  chatCount = 0;
}

function normalizeLine(line) {
  return String(line || "")
    .replace(/^[-*]\s*/, "")
    .replace(/[\s，。、：:；;！!？?（）()「」【】]/g, "")
    .trim();
}

async function maybeSediment() {
  if (process.env.MEMORY_AUTO_EXTRACT !== "true" || !process.env.CLOUD_API_KEY) return;
  const newCount = (chatCount += 1);
  fs.writeFile(SEDIMENT_FILE, JSON.stringify({ count: newCount })).catch(() => {});
  if (newCount % 6 !== 0) return;
  const transcript = recentTurns
    .slice(-6)
    .map((turn, index) => `【第${index + 1}轮】\n用户：${turn.user}\n小满：${String(turn.assistant || "").slice(0, 300)}`)
    .join("\n\n");
  if (!transcript.trim()) return;
  try {
    const reply = await chatOnce({
      messages: [
        {
          role: "system",
          content:
            "你是记忆提取器。从用户和助手的对话里提取『值得长期记住的稳定信息』：称呼、偏好与厌恶、习惯、长期目标、正在持续进行的事、" +
            "以及用户明确纠正过助手的点。忽略一次性任务（如\"扫一下这个文件夹\"）、临时状态和寒暄。" +
            "只输出新增条目，每行一条、以 - 开头，每条不超过 30 字、必须具体到能指导以后的行为；" +
            "没有值得记的就只输出 NONE。不要输出标题、不要解释。"
        },
        { role: "user", content: `最近的对话：\n${transcript}` }
      ],
      temperature: 0.2
    });
    const text = String(reply.content || "").trim();
    if (!text || /^NONE$/i.test(text) || text.length > 600) return;
    const existing = new Set(
      (await loadPrefs()).split("\n").map(normalizeLine).filter(Boolean)
    );
    const fresh = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[-*]/.test(line))
      .filter((line) => {
        const key = normalizeLine(line);
        if (!key || key.length < 4) return false;
        return ![...existing].some((item) => item.includes(key) || key.includes(item));
      });
    if (!fresh.length) return;
    await fs.mkdir(path.join(vaultDir, ".memory"), { recursive: true });
    await fs.appendFile(path.join(vaultDir, ".memory", "candidates.jsonl"), fresh.map(content => JSON.stringify({ id: crypto.randomUUID(), content, at: new Date().toISOString(), source: transcript })).join("\n") + "\n");
    console.log(`[记忆沉淀] 新增 ${fresh.length} 条（已去重）`);
  } catch (error) {
    console.error(`[记忆沉淀] 失败（不影响聊天）：${error.message}`);
  }
}

async function readDashboard() {
  const raw = await fs.readFile(dataFile, "utf8");
  const dashboard = JSON.parse(raw);
  const notes = await listNotes();

  const domainCounts = {};
  for (const note of notes) {
    domainCounts[note.domain] = (domainCounts[note.domain] || 0) + 1;
  }

  // 行星标签与底部统计改用 vault 真实数据，不再使用演示数值
  const domains = (dashboard.domains || []).map((domain) => ({
    ...domain,
    value: `${domainCounts[domain.id] || 0} 篇`
  }));

  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const weekNew = notes.filter(
    (note) => now - new Date(note.modifiedAt).getTime() <= 7 * dayMs
  ).length;
  const activeDomains = Object.keys(domainCounts).length;
  const timestamps = notes.map((note) => new Date(note.modifiedAt).getTime());
  const spanDays = timestamps.length
    ? Math.max(1, Math.round((now - Math.min(...timestamps)) / dayMs))
    : 0;

  const metrics = [
    { label: "有效记录", value: String(notes.length), detail: "vault 实时统计" },
    { label: "近 7 天新增", value: String(weekNew), detail: "最近一周写入" },
    { label: "活跃领域", value: `${activeDomains}/6`, detail: "已有笔记的领域" },
    { label: "记录跨度", value: `${spanDays} 天`, detail: "最早一篇至今" }
  ];

  return {
    ...dashboard,
    domains,
    metrics,
    noteCount: notes.length,
    domainCounts,
    recentNotes: notes.slice(0, 6)
  };
}

async function walkMarkdown(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function listNotes() {
  const files = await walkUserNotes(vaultDir);
  const notes = [];
  for (const file of files) {
    const relative = path.relative(vaultDir, file);
    const [raw, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    const parsed = matter(raw);
    const title = String(parsed.data.title || path.basename(file, ".md"));
    // 人设/技能卡/说明文档不算"用户的笔记"，既不该出现在清单里，也不该被当成参考资料喂给模型
    if (isInternalNote(relative, title)) continue;
    notes.push({
      id: relative,
      title,
      date: formatDateValue(parsed.data.date || stat.mtime),
      createdDate: parsed.data.createdAt || parsed.data.date ? formatDateValue(parsed.data.createdAt || parsed.data.date) : null,
      origin: parsed.data.origin === "import" || relative.includes("导入资料") || (Array.isArray(parsed.data.tags) && parsed.data.tags.includes("网络摘要")) ? "import" : "authored",
      domain: String(parsed.data.domain || Object.entries(domainFolders).find(([, folder]) => relative.startsWith(folder + path.sep))?.[0] || "life"),
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
      excerpt: parsed.content
        .replace(/^#+\s*/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180),
      body: parsed.content,
      modifiedAt: stat.mtime.toISOString()
    });
  }
  return notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function safeFilename(value) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|#]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 64) || "未命名记录";
}

function formatDateValue(value) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value);
  }
  return String(value || "");
}

function queryTerms(message) {
  const normalized = message.toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const chinese = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const bigrams = chinese.flatMap((run) => {
    const terms = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.push(run.slice(index, index + 2));
    }
    return terms;
  });
  return [...new Set([...latin, ...bigrams])];
}

function rankNotes(notes, message, domain) {
  const terms = queryTerms(message);
  return notes
    .map((note) => {
      const title = note.title.toLowerCase();
      const body = note.body.toLowerCase();
      const tags = note.tags.join(" ").toLowerCase();
      const score = terms.reduce((total, term) => {
        return (
          total +
          (title.includes(term) ? 10 : 0) +
          (tags.includes(term) ? 5 : 0) +
          Math.min(body.split(term).length - 1, 4)
        );
      }, 0);
      return { note, score };
    })
    // 一句"在吗"跟任何笔记都不沾边，以前照样塞 3 篇最新笔记进上下文，
    // 模型于是转头去总结资料，答的完全不是用户问的那句话。
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.note.modifiedAt.localeCompare(a.note.modifiedAt);
    })
    .slice(0, 3)
    .map(({ note }) => note);
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "lifeos-api", time: new Date().toISOString() });
});

app.get("/api/dashboard", async (_request, response, next) => {
  try {
    response.json(await readDashboard());
  } catch (error) {
    next(error);
  }
});

// —— 神经看板专用接口 ——

// 1号框：系统监控（CPU / 内存 / 磁盘）
let lastCpuSample = null;
function sampleCpu() {
  const cpus = os.cpus();
  const sample = cpus.reduce(
    (acc, cpu) => {
      for (const key of ["user", "nice", "sys", "idle", "irq"]) {
        acc[key] += cpu.times[key];
      }
      return acc;
    },
    { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
  );
  const total = Object.values(sample).reduce((a, b) => a + b, 0);
  return { sample, total };
}

async function readDisks() {
  try {
    const { stdout } = await execFileAsync("df", ["-k", "/System/Volumes/Data", "/Volumes/MacData"]);
    const lines = stdout.trim().split("\n").slice(1);
    return lines.map((line) => {
      const cols = line.split(/\s+/);
      const sizeKb = Number(cols[1]);
      const usedKb = Number(cols[2]);
      const mount = cols.slice(8).join(" ");
      return {
        mount,
        name: mount === "/Volumes/MacData" ? "外接硬盘 MacData" : "内置硬盘",
        totalGb: (sizeKb / 1048576).toFixed(0),
        usedGb: (usedKb / 1048576).toFixed(0),
        usedPercent: Math.round((usedKb / sizeKb) * 100)
      };
    });
  } catch {
    return [];
  }
}

// 本机 AI 服务探测（1号框：哪些 AI 大件在跑）
import net from "node:net";

let aiServiceCache = { at: 0, data: null };

function probePort(port, host = "127.0.0.1", timeout = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function readAiServices() {
  // 1号框每 4 秒问一次，而这活要 5 次 TCP 探测 + 调 curl + 启动 docker CLI。
  // 每次都真查，机器会一直有子进程在起，风扇跟着转；这里缓存 20 秒，界面体感不变。
  const cached = aiServiceCache;
  if (cached.data && Date.now() - cached.at < 20000) return cached.data;
  const defs = [
    { port: 11434, name: "Ollama", desc: "本地模型" },
    { port: 50060, name: "Whisper", desc: "语音识别" },
    { port: 8080, name: "Open WebUI", desc: "模型前端" },
    { port: 80, name: "Dify", desc: "工作流引擎" },
    { port: 3000, name: "Dify", desc: "工作流引擎" }
  ];
  const seen = new Set();
  const services = [];
  // 五个端口并发探，串行最坏要 2.5 秒
  const probed = await Promise.all(defs.map((def) => probePort(def.port)));
  defs.forEach((def, index) => {
    const key = def.name;
    if (probed[index] && !seen.has(key)) {
      seen.add(key);
      services.push({ name: def.name, desc: def.desc, port: def.port, running: true });
    }
  });
  // Ollama 在跑则顺带拿模型清单
  let ollamaModels = [];
  if (seen.has("Ollama")) {
    try {
      const { stdout } = await execFileAsync(
        "curl",
        ["-s", "--max-time", "2", "http://127.0.0.1:11434/api/tags"],
        { timeout: 3000 }
      );
      ollamaModels = (JSON.parse(stdout).models || []).map((m) => m.name);
    } catch {}
  }
  // Docker 里跑的容器也算 AI 服务线索（docker 可用才查）
  let dockerContainers = [];
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}}"], { timeout: 3000 });
    dockerContainers = stdout.trim().split("\n").filter(Boolean);
  } catch {}
  const data = { services, ollamaModels, dockerContainers };
  aiServiceCache = { at: Date.now(), data };
  return data;
}

app.get("/api/system", async (_request, response) => {
  const current = sampleCpu();
  let cpuPercent = 0;
  if (lastCpuSample) {
    const totalDelta = current.total - lastCpuSample.total;
    const idleDelta = current.sample.idle - lastCpuSample.sample.idle;
    if (totalDelta > 0) cpuPercent = Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  }
  lastCpuSample = current;
  const totalMem = os.totalmem();
  const usedMem = totalMem - os.freemem();
  response.json({
    cpuPercent,
    cpuCores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model?.split("@")[0]?.trim() || "",
    memory: {
      totalGb: (totalMem / 1073741824).toFixed(0),
      usedGb: (usedMem / 1073741824).toFixed(1),
      usedPercent: Math.round((usedMem / totalMem) * 100)
    },
    disks: await readDisks(),
    aiServices: await readAiServices(),
    uptimeDays: (os.uptime() / 86400).toFixed(1),
    timestamp: Date.now()
  });
});

// 2号框：原面板信息浓缩 + 蒸馏进度
app.get("/api/lifeos/overview", async (_request, response, next) => {
  try {
    const dashboard = await readDashboard();
    const skills = await listSkills();
    let pending = 0;
    try {
      // "待蒸 N 篇"要算真正还没蒸过的：蒸完的文件还留在待蒸馏里，
      // 以前照样计数，用户看到"待蒸 1 篇"以为还有活儿没干。
      const files = await listPendingMaterials();
      const log = await readDistilledLog();
      const done = new Set(Object.values(log).map((item) => String(item.title || "")));
      const jobs = await listDistillJobs();
      const enabled = new Set(jobs.filter(j=>j.status==="enabled").map(j=>j.title));
      pending = files.filter((file) => !done.has(file.name) && !enabled.has(file.name)).length;
    } catch {}
    response.json({
      metrics: dashboard.metrics,
      events: (dashboard.events || []).slice(0, 4),
      recentNotes: dashboard.recentNotes.slice(0, 3).map((n) => ({
        id: n.id,
        title: n.title,
        date: n.date,
        excerpt: n.excerpt.slice(0, 60)
      })),
      distill: {
        skillCount: skills.length,
        skills: skills.map((s) => ({ name: s.name, description: s.description })),
        pending
      },
      noteCount: dashboard.noteCount
    });
  } catch (error) {
    next(error);
  }
});

// 4号框：成长曲线（最近 14 天每日笔记数）
app.get("/api/lifeos/growth", async (_request, response, next) => {
  try {
    response.json(growthReport(await listNotes(), await readProgress()));
  } catch (error) {
    next(error);
  }
});

// AI 工作台水母：小满实时活动状态
app.get("/api/activity", async (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json(await readExternalActivity(activity));
});

app.get("/api/notes", async (request, response, next) => {
  try {
    const notes = await listNotes();
    const domain = typeof request.query.domain === "string" ? request.query.domain : "";
    response.json(domain ? notes.filter((note) => note.domain === domain) : notes);
  } catch (error) {
    next(error);
  }
});

app.post("/api/notes", async (request, response, next) => {
  try {
    const { title, body, domain = "life", tags = [] } = request.body ?? {};
    if (!title || !body) {
      return response.status(400).json({ error: "标题和正文不能为空。" });
    }
    const folder = domainFolders[domain] || domainFolders.life;
    const directory = path.join(vaultDir, folder);
    await fs.mkdir(directory, { recursive: true });
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const filename = `${date}-${safeFilename(title)}.md`;
    let target = path.join(directory, filename);
    try {
      await fs.access(target);
      target = path.join(directory, `${date}-${safeFilename(title)}-${Date.now()}.md`);
    } catch {
      // File does not exist yet.
    }
    const tagLines = Array.isArray(tags) && tags.length
      ? `tags:\n${tags.map((tag) => `  - ${JSON.stringify(String(tag))}`).join("\n")}`
      : "tags: []";
    const source = [
      "---",
      `title: ${JSON.stringify(String(title))}`,
      `date: ${date}`,
      `domain: ${String(domain)}`,
      tagLines,
      "---",
      "",
      String(body),
      ""
    ].join("\n");
    await fs.writeFile(target, source, "utf8");
    response.status(201).json({
      ok: true,
      path: path.relative(projectRoot, target),
      title: String(title),
      domain: String(domain)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", async (_request, response) => {
  response.json(await modelProvider.getStatus());
});

app.get("/api/voice/status", async (_request, response) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const whisperResponse = await fetch(`${whisperUrl}/v1/audio/transcriptions`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);
    response.json({
      online: whisperResponse.status < 500,
      language: whisperLanguage,
      url: whisperUrl
    });
  } catch {
    response.json({ online: false, language: whisperLanguage, url: whisperUrl });
  }
});

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

app.post(
  "/api/voice/transcribe",
  express.raw({
    type: ["audio/*", "application/octet-stream"],
    limit: "25mb"
  }),
  async (request, response) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: "没有收到语音数据。" });
    }

    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "lifeos-voice-")
    );
    const inputPath = path.join(temporaryDirectory, "recording.webm");
    const wavPath = path.join(temporaryDirectory, "recording.wav");

    try {
      await fs.writeFile(inputPath, request.body);
      await runCommand(ffmpegPath, [
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath
      ]);
      const wav = await fs.readFile(wavPath);
      const form = new FormData();
      form.append("file", new Blob([wav], { type: "audio/wav" }), "recording.wav");
      form.append("model", "small");
      form.append("language", whisperLanguage);
      form.append("response_format", "json");

      const whisperResponse = await fetch(`${whisperUrl}/v1/audio/transcriptions`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000)
      });
      if (!whisperResponse.ok) {
        throw new Error(`WhisperKit ${whisperResponse.status}`);
      }
      const result = await whisperResponse.json();
      const text = String(result.text || "").trim();
      const rms = wavRms(wav);
      // 静音或纯噪声：直接判空，别把幻觉字幕当用户说的话
      if (rms < 0.006 || (text.length <= 40 && WHISPER_ECHO.test(text))) {
        return response.json({ text: "", language: whisperLanguage, silent: true });
      }
      response.json({
        text,
        language: whisperLanguage
      });
    } catch (error) {
      response.status(503).json({
        error: "本地语音识别暂不可用。",
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

app.post("/api/chat", (request, response, next) => {
  const controller = new AbortController();
  response.on("close", () => { if (!response.writableEnded) controller.abort(); });
  return taskContext.run({sessionId:String(request.body?.sessionId || "legacy"),signal:controller.signal}, async () => {
  const { message, history = [], domain = "", sessionId = "legacy" } = request.body ?? {};
  if (!message || typeof message !== "string") {
    return response.status(400).json({ error: "消息不能为空。" });
  }

  const routed = routeMessage(message);
  countTask(); // 每次对话都计入 AI 工作台今日工作量
  const currentTurn = { user: routed.text, assistant: "" };
  recentTurns.push(currentTurn);
  if (recentTurns.length > 20) recentTurns.splice(0, recentTurns.length - 20);
  appendChat({ sessionId, role: "user", content: routed.text });

  // 用户直接粘网址时：服务端确定性地抓正文。以前全靠模型自己决定调 fetch_page，
  // 结果它经常直接回"我无法访问外部网站"，链接等于白给。
  const urlInMessage = extractFirstUrl(message);
  let pageBlock = "";
  let pageInfo = null;
  if (urlInMessage) {
    try {
      const page = await fetchPageTool({ url: urlInMessage });
      pageInfo = page;
      pageBlock = `\n\n[已读取网页正文：${page.title}｜${page.url}｜${page.contentLength} 字]\n${page.content}`;
      console.log(`[网页] 已读取 ${page.url}（${page.contentLength} 字，${page.via}）`);
    } catch (error) {
      pageBlock = `\n\n[网页读取失败：${urlInMessage}（${error.message}）—— 如实告诉用户没抓到，绝对不要编造网页内容]`;
    }
  }

  const notes = await listNotes();
  const relevant = rankNotes(notes, routed.text, domain);
  const sources = relevant.map((note) => ({
    title: note.title,
    id: note.id,
    date: note.date
  }));

  // 时效性问题先真搜一次：模型嘴上常挂"我无法访问互联网"，与其赌它自觉调工具，
  // 不如服务端先搜好、把结果塞进资料区（和"用户给链接就先抓正文"是同一个思路）。
  let searchBlock = "";
  let searchCount = 0;
  if (
    !urlInMessage &&
    SEARCH_HINTS.test(routed.text) &&
    !LOCAL_OBJECT.test(routed.text) &&
    !SELF_STATE.test(routed.text) &&
    !/(蒸馏|蒸一下|做成技能|技能卡)/.test(routed.text)
  ) {
    try {
      // 整句口语直接拿去搜，命中率很差（实测"最近王老师都发什么内容了"搜回 YouTube 和 Reddit）。
      // 先让模型压成关键词，并带上前两轮里出现过的人名，解决"王老师"这类指代。
      let contextLines = Array.isArray(history)
        ? history
            .filter((item) => item && item.role === "user")
            .slice(-2)
            .map((item) => String(item.content).slice(0, 80))
        : [];
      if (!contextLines.length) {
        // 前端没带 history（比如刚重启）就从当天存档里捞，别让"王老师"变成无主语
        try {
          const raw = await fs.readFile(path.join(chatsDir, `${todayKey()}.jsonl`), "utf8");
          const rows = raw
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .filter((row) => row.role === "user");
          // 去重：同一句话连问五遍时，别让它把"你找找王德峰"那句挤出上下文
          const uniq = [...new Set(rows.map((row) => String(row.content).slice(0, 60)))];
          contextLines = uniq.slice(-4);
        } catch {}
      }
      let query = routed.text.slice(0, 90);
      try {
        const rewritten = await chatOnce({
          messages: [
            {
              role: "system",
              content:
                "生成搜索引擎关键词。规则：\n" +
                "1. 如果当前问题里的人名/项目是代称（如「王老师」「那个产品」），从对话历史里找出真实全名并替换\n" +
                "2. 保留时间词（最近、今年）与关键实体\n" +
                "3. 去掉疑问词、语气词、重复表达\n" +
                "4. 输出 3-8 个词，空格分隔，不要标点，只输出关键词本身"
            },
            {
              role: "user",
              content: `${contextLines.join(" / ")} / ${routed.text}`.slice(0, 400)
            }
          ],
          temperature: 0.2
        });
        const polished = String(rewritten.content || "").trim().replace(/[「」"""'']/g, "");
        if (polished.length >= 2 && polished.length <= 60) query = polished;
        // 规则兜底：历史里出现过"你找找 X"，说明 X 就是用户说的那个对象，
        // 直接把代称换掉，别指望小模型每次都记得上下文。
        const nameHit = contextLines
          .join(" ")
          .match(/(?:找找|查查|搜搜|看看|了解一下|关注)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,8})/);
        if (nameHit && /(老师|教授|先生|他|她|这位)/.test(routed.text)) {
          query = query.replace(/王老师|这位老师|这位|老师|他|她/g, nameHit[1]).trim();
          if (!query.includes(nameHit[1])) query = `${nameHit[1]} ${query}`;
        }
      } catch {
        // 改写失败就用原句，不影响主流程
      }
      const found = await webSearchTool({ query, max_results: 5 });
      searchCount = found.resultCount;
      searchBlock =
        `\n\n[已联网搜索：${found.query}｜${found.resultCount} 条]\n` +
        "(标注「无发布时间」的结果，回答时不要给它编日期)\n" +
        found.results
          .map(
            (item, i) =>
              `${i + 1}. ${item.title}（${item.publishedAt || "无发布时间"}）\n${item.snippet}\n${item.url}`
          )
          .join("\n");
      console.log(
        `[搜索] ${found.query} → ${found.resultCount} 条${found.cached ? "（命中缓存）" : ""}`
      );
    } catch (error) {
      searchBlock = `\n\n[联网搜索失败：${error.message}。如需最新信息请如实告知用户当前网络不可用，禁止编造。]`;
      console.log(`[搜索失败] ${error.message}`);
    }
  }

  const sourceBlock =
    (relevant.length
      ? relevant
          .map(
            (note) =>
              `[资料：${note.title}｜${note.date}｜${note.id}]\n${note.body.slice(0, 1200)}`
          )
          .join("\n\n")
      : "当前领域没有找到可用资料。") +
    pageBlock +
    searchBlock;

  const recentHistory = Array.isArray(history)
    ? history
        .slice(-8)
        .filter((item) => item && ["user", "assistant"].includes(item.role))
        .map((item) => ({
          role: item.role,
          content: String(item.content).slice(0, 2000)
        }))
    : [];

  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  // 连接结束（正常收尾或客户端断开）都把看板从"工作中"收回原色
  response.on("close", () => endActivity());
  response.write(JSON.stringify({ type: "sources", sources }) + "\n");
  if (searchCount) {
    response.write(
      JSON.stringify({ type: "notice", message: `已联网搜到 ${searchCount} 条结果` }) + "\n"
    );
  }

  try {
    const [persona, prefs, skills] = await Promise.all([
      loadPersona(),
      loadPrefs(),
      listSkills()
    ]);
    const activeSkill = matchSkill(routed.text, skills);
    if (activeSkill) response.write(JSON.stringify({type:"notice",message:`使用技能：${activeSkill.name}`}) + "\n");
    const activeSkillBody = activeSkill
      ? activeSkill.body.slice(0, 12000) + "\n\n" + await loadSkillReferences(activeSkill)
      : "";
    const skillsIndex = buildSkillsIndex(
      skills.filter((skill) => skill !== activeSkill)
    );
    const personaBlock = skillsIndex
      ? `${persona.trim()}\n\n${skillsIndex}`
      : persona;
    const matchedDistillSkill =
      activeSkill && /蒸馏/.test(activeSkill.name + activeSkill.aliases.join("/"));
    // 问"库里有没有/是哪个"是查目录，不是蒸馏；先把它挑出来，避免又白蒸一遍
    const libraryQuery = !pageInfo?.content && isLibraryQuery(routed.text);
    const isDistill =
      !libraryQuery && (isDistillRequest(routed.text) || Boolean(matchedDistillSkill));
    const confirmingPlan =
      /^确认执行\s+P[a-z0-9]+-\d+$/i.test(routed.text.trim());
    // 看板一旦开始干活就转红：蒸馏是深红持续脉动，普通对话是红色呼吸
    beginActivity(isDistill ? "distill" : "chat", isDistill ? "蒸馏中" : "对话中");
    // 查蒸馏库/技能库：直接读盘回答，一句话说清"有没有、叫什么、蒸没蒸过"
    if (libraryQuery) {
      const message = await describeLibrary(routed.text);
      currentTurn.assistant = message;
      appendChat({ sessionId, role: "assistant", content: message });
      response.write(JSON.stringify({ type: "delta", content: message }) + "\n");
      response.write(JSON.stringify({ type: "done" }) + "\n");
      response.end();
      return;
    }
    // 蒸馏：服务端确定性执行（读素材 → 生成 → 质检 → 落盘），不依赖模型自觉调工具
    if (isDistill) {
      const readNoteById = async (id) => {
        const target = path.resolve(vaultDir, id);
        if (!target.startsWith(vaultDir + path.sep)) throw new Error("笔记路径不合法");
        return matter(await fs.readFile(target, "utf8")).content.trim();
      };
      let source = "";
      let sourceTitle = pageInfo?.title || "";
      let fetchError = "";
      if (pageInfo?.content) {
        source = pageInfo.content;
      } else if (!urlInMessage && routed.text.length > 400) {
        // 用户直接把正文粘进来了（抓不到链接时我就建议他这么干，这条路必须真的通）
        source = routed.text;
        sourceTitle = "粘贴的正文";
        response.write(
          JSON.stringify({ type: "notice", message: "用你贴进来的正文当素材" }) + "\n"
        );
      } else if (urlInMessage) {
        try {
          const saved = await downloadUrlTool({ url: urlInMessage });
          if (saved?.saved && saved.chars) {
            source = await readNoteById(saved.saved);
            sourceTitle = saved.title || sourceTitle;
            response.write(
              JSON.stringify({ type: "notice", message: `已存成笔记：${saved.saved}` }) + "\n"
            );
          }
        } catch (error) {
          fetchError = error instanceof Error ? error.message : String(error);
          response.write(
            JSON.stringify({ type: "notice", message: `网页抓取失败：${fetchError}` }) + "\n"
          );
        }
      }
      // 给了链接却抓不到：绝不能退回"待蒸馏最新一篇"，否则会拿一篇毫不相干的资料去蒸，
      // 用户看到的还是"素材太薄"，完全对不上他给的链接。
      if (!source && urlInMessage) {
        const message =
          `这个链接的正文抓不到：${fetchError || "站点拦截或内容为空"}。\n\n` +
          "常见拦截站点：知乎、小红书、微博、部分公众号文章。两个办法：\n" +
          "1. 在浏览器里打开那篇文章，全选复制，直接粘给我（我能蒸）\n" +
          "2. 换一个公开博客/维基/公众号镜像的链接试试";
        currentTurn.assistant = message;
        appendChat({ sessionId, role: "assistant", content: message });
        response.write(JSON.stringify({ type: "delta", content: message }) + "\n");
        response.write(JSON.stringify({ type: "done" }) + "\n");
        response.end();
        return;
      }
      // 没链接也没长文：先按标题在笔记里找，再退到「待蒸馏」里最新一篇
      if (!source) {
        const named = notes.find(
          (note) => note.title.length >= 2 && routed.text.includes(note.title)
        );
        if (named) {
          source = await readNoteById(named.id);
          sourceTitle = named.title;
          response.write(
            JSON.stringify({ type: "notice", message: `用笔记「${named.title}」当素材` }) + "\n"
          );
        } else {
          const files = await listPendingMaterials();
          if (files.length) {
            // 用户点名了某一篇就蒸那一篇，别一律取最新（待蒸馏里可能堆着好几篇）
            const clean = routed.text.replace(/[《》「」"'“”\s]/g, "");
            const asked =
              files.find((file) => routed.text.includes(file.name)) ||
              (clean.length >= 4 ? files.find((file) => file.name.includes(clean)) : null);
            const pick = asked || files[0];
            source = await readNoteById(pick.rel);
            sourceTitle = pick.name;
            response.write(
              JSON.stringify({
                type: "notice",
                message: asked
                  ? `用「待蒸馏」里的：${sourceTitle}`
                  : `没指定素材，取「待蒸馏」里最新一篇：${sourceTitle}`
              }) + "\n"
            );
          }
        }
      }
      if (!source) {
        const message =
          "没找到要蒸的素材。三种给法，随便哪种都行：\n" +
          "1. 直接粘一段正文（400 字以上）给我，末尾加一句「蒸馏成技能」\n" +
          "2. 给我一个能打开的链接（知乎/小红书这类反爬站点可能抓不到）\n" +
          "3. 把文件放进 vault/待蒸馏/，然后说「蒸一下」";
        currentTurn.assistant = message;
        appendChat({ sessionId, role: "assistant", content: message });
        response.write(JSON.stringify({ type: "delta", content: message }) + "\n");
        response.write(JSON.stringify({ type: "done" }) + "\n");
        response.end();
        return;
      }
      // 同一份素材蒸过就别再蒸一遍：之前问"库里有没有那个文档"被误判成蒸馏，
      // 同一篇连蒸两次，技能库里多出 xxx 和 xxx-v2 两个几乎一样的卡。
      const forceRedistill = /(重蒸|再蒸一|重新蒸|再蒸馏一次|蒸一版新)/.test(routed.text);
      const sourceHash = materialHash(source);
      if (!forceRedistill) {
        const prev = (await readDistilledLog())[sourceHash];
        if (prev) {
          const when = prev.at ? shortTime(new Date(prev.at).getTime()) : "之前";
          const message =
            `这篇 ${when} 已经蒸过了：技能「${prev.skill || prev.folder}」在 \`${prev.saved || prev.folder}\`。\n\n` +
            "同一份素材重复蒸只会多出一张几乎一样的卡（之前就是这么多出 -v2 的），所以我没再动手。\n" +
            "真要重蒸一版，就说「重蒸」。";
          currentTurn.assistant = message;
          appendChat({ sessionId, role: "assistant", content: message });
          response.write(JSON.stringify({ type: "delta", content: message }) + "\n");
          response.write(JSON.stringify({ type: "done" }) + "\n");
          response.end();
          return;
        }
      }
      try {
        const result = await runDistill({
          source,
          title: sourceTitle,
          purpose: String(request.body.purpose || routed.text.match(/(?:用途|目的|用来)[：:]\s*([\s\S]+)/)?.[1] || ""),
          signal: controller.signal,
          onNotice: (message) =>
            response.write(JSON.stringify({ type: "notice", message }) + "\n")
        });
        /* 候选尚未启用，不登记为已安装技能。
        await markDistilled(sourceHash, {
          title: sourceTitle,
          skill: result.name,
          folder: result.folder,
          saved: result.saved
        }).catch(() => {}); */
        const summary = `已完成候选提取：${result.title}，覆盖 ${result.coverage.length}/${result.blocks.length} 块，共 ${result.candidates.length} 个候选。尚未启用技能。请在蒸馏工作台筛选、生成草稿并试跑。`;
        currentTurn.assistant = summary;
        appendChat({ sessionId, role: "assistant", content: summary });
        response.write(JSON.stringify({ type: "delta", content: summary }) + "\n");
        response.write(JSON.stringify({ type: "done" }) + "\n");
        response.end();
        maybeSediment().catch(() => {});
        return;
      } catch (error) {
        console.error(`[蒸馏失败] ${error instanceof Error ? error.message : String(error)}`);
        // 素材不是方法论（人物词条/新闻/背景资料）：不硬蒸，改出一份能用的摘要，
        // 并告诉用户往哪个方向追问才能蒸出技能卡。
        // 不管是"素材不是方法论"还是"两次都没过质检"，都降级出摘要：
        // 用户给了链接就得拿到点东西，不能只回一句"没蒸成"。
        if (!/用途|目的|素材太短|没抓到正文|取消|abort/i.test(String(error?.message || ""))) {
          try {
            const sum = await summarizeMaterial({
              source,
              title: sourceTitle,
              onNotice: (message) =>
                response.write(JSON.stringify({ type: "notice", message }) + "\n")
            });
            const message =
              `这篇蒸不出技能卡——${error.message}。\n\n` +
              `我给你做了一份摘要，存在 ${sum.saved}：\n\n` +
              sum.content.slice(0, 700) +
              (sum.content.length > 700 ? "\n\n（完整版在笔记里）" : "");
            currentTurn.assistant = message;
            appendChat({ sessionId, role: "assistant", content: message });
            response.write(JSON.stringify({ type: "delta", content: message }) + "\n");
            response.write(JSON.stringify({ type: "done" }) + "\n");
            response.end();
            maybeSediment().catch(() => {});
            return;
          } catch (summaryError) {
            console.error(`[摘要失败] ${summaryError.message}`);
          }
        }
        const message =
          `蒸馏未完成：${error.message}。可在蒸馏工作台补充信息后续跑。`;
        currentTurn.assistant = message;
        appendChat({ sessionId, role: "assistant", content: message });
        response.write(JSON.stringify({ type: "delta", content: message }) + "\n");
        response.write(JSON.stringify({ type: "done" }) + "\n");
        response.end();
        return;
      }
    }

    const searchHint = searchBlock.includes("已联网搜索")
      ? "\n\n【资料区里已经有联网搜索结果】直接基于这些结果回答，注明来源与时间；" +
        "禁止回答「我无法访问互联网」「我无法实时获取信息」这类话。结果不足以回答就如实说没搜到，不要编。" +
        "结果标注「无发布时间」时不要给它补日期；与问题无关的结果直接忽略，不要硬凑条数。"
      : "";
    const finalUserContent =
      (confirmingPlan
        ? `${routed.text}\n\n【强制】用户已确认执行方案。必须立即调用 execute_file_ops 工具（planId 可省略，默认最新方案），禁止只描述过程或用文字假装执行。工具返回后才能汇报结果。`
        : activeSkill
          ? `${routed.text}\n\n【技能模式】已激活技能「${activeSkill.name}」，按该技能的方法论回答。` +
            "资料区里已经给出相关笔记正文时，直接依据它回答，不要再去抓笔记里的外链（GitHub、公众号之类）；" +
            "只有资料区为空时才调用 list_notes/read_note 查真实内容。禁止编造用户没提供过的事实，" +
            "也禁止回答「我无法访问您提供的链接」——资料就在上面。"
          : routed.text) + searchHint;

    // 需要动手的活（查资料/联网/读网页/蒸馏）一律走云端：工具调用只有云端模型支持，
    // 本地 qwen 拿不到 tools 就会"嘴上说做了"，这是之前"查笔记却在瞎猜"的根因。
    // 但资料区里已经有相关笔记正文时，别再因为"命中了技能"就去开工具轮次——
    // 之前就是这么把一条"这篇讲了什么"变成了 fetch_page 抓 GitHub 链接，最后答"无法访问链接"。
    const needsTools =
      TOOL_INTENT.test(routed.text) ||
      (Boolean(activeSkill) && relevant.length === 0) ||
      Boolean(urlInMessage);
    let provider = resolveProvider(routed.key);
    if (needsTools && provider.name !== "zhipu-glm" && isCloudAvailable()) {
      provider = cloudProvider;
      response.write(
        JSON.stringify({ type: "notice", message: "需要查资料/联网，已切到云端" }) + "\n"
      );
    }
    // 出问题时最想知道的就是"这次到底谁在答、塞了多少上下文"，直接打在日志里
    console.log(
      `[对话] ${provider.name}｜资料 ${sourceBlock.length} 字｜历史 ${recentHistory.length} 条｜技能 ${activeSkill?.name || "无"}`
    );
    const messages = [
      {
        role: "system",
        // 资料放系统消息里，不再作为一条 user 消息塞在提问前面。
        // 之前那样排，模型常把"资料"当成用户说的话，开口就是"我已经获取到您的本地资料"。
        content:
          buildSystemPrompt(personaBlock, prefs, activeSkillBody) +
          (sourceBlock
            ? `\n\n# 参考资料（仅备查，不要主动复述或总结；与当前问题无关就完全忽略）\n${sourceBlock}`
            : "") +
          // 提示词放最后重申一遍：模型对结尾的指令最敏感，
          // 之前人设写在开头，一句"在吗"它就回了客服腔。
          "\n\n（提醒：你是小满，用户的自己人。短句、直接、有态度。禁止「有什么可以帮助您的吗」这类开场。）"
      },
      ...recentHistory,
      { role: "user", content: finalUserContent }
    ];

    // 用户确认执行：由服务端确定性执行，避免模型"假装执行"
    if (confirmingPlan) {
      taskContext.getStore().confirmedPlan = routed.text.trim().split(/\s+/)[1];
      try {
        const result = await executeFileOpsTool({ planId: routed.text.trim().split(/\s+/)[1] });
        const lines = result.results.map(
          (r, i) =>
            `${i + 1}. ${r.ok ? "✅" : "⚠️"} ${r.from} → ${r.to}${r.ok ? "" : `（${r.error}）`}`
        );
        const summary =
          `已执行 ${result.executed}/${result.total} 项：\n` + lines.join("\n");
        currentTurn.assistant = summary;
        appendChat({ sessionId, role: "assistant", content: summary });
        response.write(JSON.stringify({ type: "delta", content: summary }) + "\n");
        response.write(JSON.stringify({ type: "done" }) + "\n");
        response.end();
        maybeSediment().catch(() => {});
        return;
      } catch (error) {
        response.write(
          JSON.stringify({
            type: "delta",
            content: `执行失败：${error.message}。可以重新说一次整理需求，我重新生成方案。`
          }) + "\n"
        );
        response.write(JSON.stringify({ type: "done" }) + "\n");
        response.end();
        return;
      }
    }

    // 网页正文已经由服务端抓好塞进上下文，普通"总结这篇"不必再绕一圈工具；
    // 蒸馏/下载/查笔记这类才需要真的动手。
    const wantsDownload = /(下载|存下来|保存到|存成文件)/.test(routed.text);
    const pageHandled = Boolean(pageBlock) && !isDistill && !wantsDownload;
    const shouldUseTools = provider.name === "zhipu-glm" && needsTools && !pageHandled;

    if (shouldUseTools) {
      try {
        const answer = await runAgentLoop({
          messages,
          signal: controller.signal,
          temperature: 0.4,
          maxRounds: isDistill ? 12 : 6,
          mode: isDistill ? "distill" : "chat",
          onNotice: (noticeMessage) => {
            response.write(
              JSON.stringify({ type: "notice", message: noticeMessage }) + "\n"
            );
          }
        });
        if (answer) {
          currentTurn.assistant = answer;
          appendChat({ sessionId, role: "assistant", content: answer });
          response.write(JSON.stringify({ type: "delta", content: answer }) + "\n");
          response.write(JSON.stringify({ type: "done" }) + "\n");
          response.end();
          maybeSediment().catch(() => {});
          return;
        }
      } catch (error) {
        throw error;
      }
    }

    const streamOptions = {
      messages,
      signal: controller.signal,
      temperature: provider.name === "zhipu-glm" ? 0.8 : 0.7
    };

    async function startStream() {
      try {
        const iterator = provider.streamChat(streamOptions);
        const first = await iterator.next();
        return { first, iterator };
      } catch (error) {
        if (controller.signal.aborted || provider === localProvider) throw error;
        console.error(`云端不可用，回落本地：${error.message}`);
        response.write(
          JSON.stringify({
            type: "notice",
            message: "云端暂时不可用，已切换本地模型。"
          }) + "\n"
        );
        const iterator = localProvider.streamChat(streamOptions);
        const first = await iterator.next();
        return { first, iterator };
      }
    }

    const { first, iterator } = await startStream();

    let streamed = "";
    if (first && !first.done) {
      const firstEvent = first.value;
      if (firstEvent && firstEvent.type !== "done") {
        if (firstEvent.type === "delta") streamed += String(firstEvent.content || "");
        response.write(JSON.stringify(firstEvent) + "\n");
      }
      for await (const event of iterator) {
        if (event.type === "done") break;
        if (event.type === "delta") streamed += String(event.content || "");
        response.write(JSON.stringify(event) + "\n");
      }
    }
    if (streamed) {
      currentTurn.assistant = streamed;
      appendChat({ sessionId, role: "assistant", content: streamed });
    }
    response.end();
    maybeSediment().catch(() => {});
  } catch (error) {
    response.write(
      JSON.stringify({
        type: "error",
        message: `本地模型暂时不可用：${error instanceof Error ? error.message : String(error)}`
      }) + "\n"
    );
    response.end();
  }
  }).catch(next);
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "服务器处理失败。", detail: error.message });
});

await fs.mkdir(vaultDir, { recursive: true });

app.use(express.static(distDir));
app.get(/.*/, async (_request, response) => {
  const indexFile = path.join(distDir, "index.html");
  try {
    await fs.access(indexFile);
    response.sendFile(indexFile);
  } catch {
    response
      .status(200)
      .type("text/plain")
      .send("LifeOS API is running. Start the Vite development server with `pnpm dev`.");
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`LifeOS API: http://127.0.0.1:${port}`);
  console.log(
    `Model provider: ${isCloudAvailable() ? cloudProvider.name : localProvider.name}`
  );
});
