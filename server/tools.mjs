import { promises as fs } from "node:fs";
import os from "node:os";
import { taskContext, checkTask } from "./taskContext.mjs";
import path from "node:path";
import matter from "gray-matter";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { vaultDir, walkUserNotes, isInternalNote } from "./vaultNotes.mjs";

const execFileAsync = promisify(execFile);
const homeDir = os.homedir();

const SCAN_SKIP = new Set([
  "node_modules",
  "Library",
  ".Trash",
  ".git",
  ".local",
  ".cache",
  ".npm",
  ".pnpm-store"
]);

async function walkMarkdown(directory) {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
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

function safeFilename(value) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|#]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 64) || "未命名记录"
  );
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

function insideVault(relativePath) {
  const target = path.resolve(vaultDir, relativePath);
  if (target !== vaultDir && !target.startsWith(vaultDir + path.sep)) {
    return null;
  }
  return target;
}

async function listNotesTool() {
  const files = await walkUserNotes(vaultDir);
  const notes = [];
  for (const file of files) {
    const relative = path.relative(vaultDir, file);
    const [raw, stat] = await Promise.all([
      fs.readFile(file, "utf8"),
      fs.stat(file)
    ]);
    const parsed = matter(raw);
    const title = String(parsed.data.title || path.basename(file, ".md"));
    if (isInternalNote(relative, title)) continue;
    notes.push({
      id: relative,
      title,
      date: formatDateValue(parsed.data.date || stat.mtime)
    });
  }
  notes.sort((a, b) => b.date.localeCompare(a.date));
  return { total: notes.length, notes: notes.slice(0, 40) };
}

async function readNoteTool({ id, offset = 0 }) {
  if (!id || typeof id !== "string") throw new Error("缺少笔记 id");
  const target = insideVault(id);
  if (!target) throw new Error("笔记路径不合法");
  const raw = await fs.readFile(target, "utf8");
  const parsed = matter(raw);
  const body = parsed.content.trim();
  const start = Math.max(0, Number(offset) || 0);
  const chunk = body.slice(start, start + 6000);
  const nextOffset = start + chunk.length < body.length ? start + chunk.length : null;
  return {
    title: String(parsed.data.title || path.basename(target, ".md")),
    totalLength: body.length,
    offset: start,
    nextOffset,
    content: chunk
  };
}

async function writeNoteTool({ title, content }) {
  if (!title || typeof title !== "string") throw new Error("缺少笔记标题");
  if (!content || typeof content !== "string") throw new Error("缺少笔记内容");
  const inboxDir = path.join(vaultDir, "00 收件箱");
  const target = path.join(inboxDir, `${safeFilename(title)}.md`);
  try {
    await fs.access(target);
    throw new Error("同名笔记已存在，为避免覆盖已取消写入");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(inboxDir, { recursive: true });
  const frontmatter = [
    "---",
    `title: ${title.trim()}`,
    `date: ${formatDateValue(new Date())}`,
    "domain: life",
    "tags:",
    "  - 小满",
    "---",
    ""
  ].join("\n");
  await fs.writeFile(target, frontmatter + content.trim() + "\n", "utf8");
  return { ok: true, saved: path.relative(vaultDir, target) };
}

async function walkFiles(directory, depth = 0, budget = { count: 0 }) {
  if (depth > 6 || budget.count > 20000) return [];
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SCAN_SKIP.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath, depth + 1, budget)));
    } else if (entry.isFile()) {
      budget.count += 1;
      files.push(fullPath);
    }
  }
  return files;
}

const CHINESE_DIR_NAMES = {
  下载: "Downloads",
  下载文件夹: "Downloads",
  文档: "Documents",
  文档文件夹: "Documents",
  桌面: "Desktop",
  桌面文件夹: "Desktop",
  图片: "Pictures",
  电影: "Movies",
  音乐: "Music"
};

function candidateDirectories(input) {
  let raw = String(input || "").trim();
  if (!raw) throw new Error("缺少目录路径");
  if (raw.startsWith("~")) {
    raw = homeDir + raw.slice(1);
  }
  const candidates = [];
  if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
    if (!raw.startsWith(homeDir)) {
      candidates.push(path.join(homeDir, raw));
    }
  } else {
    candidates.push(path.join(homeDir, raw));
    candidates.push(path.resolve(raw));
    const baseName = raw.replace(/文件夹$/, "").replace(/\/+$/, "");
    if (CHINESE_DIR_NAMES[baseName]) {
      candidates.push(path.join(homeDir, CHINESE_DIR_NAMES[baseName]));
    }
  }
  return [...new Set(candidates)];
}

async function scanDirectoryTool({ directory, top = 15 }) {
  const candidates = candidateDirectories(directory);
  let target = null;
  for (const candidate of candidates) {
    const info = await fs.stat(candidate).catch(() => null);
    if (info?.isDirectory()) {
      target = candidate;
      break;
    }
  }
  if (!target) {
    throw new Error(
      `这些路径都不存在或不是文件夹：${candidates.join("、")}。请让用户确认文件夹位置（例如 /Users/${path.basename(homeDir)}/Downloads）`
    );
  }
  if (!target.startsWith(homeDir + path.sep) && target !== homeDir) {
    throw new Error("只允许扫描用户主目录范围内的路径");
  }
  const budget = { count: 0 };
  const files = await walkFiles(target, 0, budget);
  const sized = [];
  for (const file of files) {
    const info = await fs.stat(file).catch(() => null);
    if (info?.isFile()) sized.push({ file, bytes: info.size });
  }
  sized.sort((a, b) => b.bytes - a.bytes);
  const limit = Math.min(Math.max(Number(top) || 15, 1), 30);
  return {
    scanned: target,
    fileCount: sized.length,
    largest: sized.slice(0, limit).map((item) => ({
      file: item.file,
      sizeMB: Number((item.bytes / 1024 / 1024).toFixed(1))
    }))
  };
}

const ANYSEARCH_API = "https://api.anysearch.com";
const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function anySearchRequest(endpoint, body, timeout = 30000) {
  const apiKey = process.env.ANYSEARCH_API_KEY || "";
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${ANYSEARCH_API}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    throw new Error(
      `搜索服务返回 ${response.status}。若提示限流，请告知用户稍后再试。`
    );
  }
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(`搜索服务错误：${payload.message || "未知错误"}`);
  }
  return payload.data || {};
}

function clipText(value, limit = 400) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToText(html) {
  const stripped = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// 从一句话里抠出第一个链接（用户经常直接把地址粘进来）
export function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"'）)】」，。]+/i);
  return match ? match[0] : "";
}

async function directFetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": FETCH_UA, Accept: "text/html,application/xhtml+xml,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`网页返回 ${response.status}`);
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 120) : "",
    content: /html|xml/i.test(type) ? htmlToText(raw) : raw.trim()
  };
}

// 反爬 / 登录墙 / 验证页的特征词。命中说明"技术上抓到了，但抓到的是墙不是正文"，
// 以前这种页面会被当成正文喂给模型，于是它拿着一句"环境异常"硬答，或者蒸馏直接失败。
const WALL_HINTS =
  /(环境异常|安全验证|请输入验证码|滑动验证|拖动滑块|访问过于频繁|访问受限|请求过于频繁|请登录后|登录后查看|登录后可|开通会员|付费阅读|Unusual traffic|Access Denied|Forbidden|Just a moment|Enable JavaScript|Client Challenge)/i;

const CHROME_BIN =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function looksLikeWall(text) {
  const head = String(text || "").slice(0, 1500);
  return WALL_HINTS.test(head);
}

// 用本机 Chrome 真浏览器抓 DOM：百度百科、部分门户站对 fetch 一律拦，
// 但真浏览器能渲染出来（实测百度百科 fetch 拿 0 字，Chrome 拿到 54 万字节 DOM）。
async function chromeFetchText(url) {
  const profile = path.join(os.tmpdir(), `lifeos-chrome-${Date.now()}`);
  try {
    const { stdout } = await execFileAsync(
      CHROME_BIN,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        "--virtual-time-budget=6000",
        `--user-data-dir=${profile}`,
        "--dump-dom",
        url
      ],
      { maxBuffer: 40 * 1024 * 1024, timeout: 22000 }
    );
    const titleMatch = String(stdout).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      title: titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim().slice(0, 120) : "",
      content: htmlToText(stdout)
    };
  } finally {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// 正文质量门槛：低于这个长度基本是导航/版权声明，不值得喂给模型
const MIN_PAGE_CHARS = 300;

export async function fetchPageTool({ url, allowChrome = true }) {
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    throw new Error("缺少合法的网页地址（必须以 http:// 或 https:// 开头）");
  }
  const target = url.trim();
  const attempts = [];
  let best = null;

  const consider = (via, data) => {
    const content = String(data?.content || "").trim();
    const title = String(data?.title || "").trim();
    if (!content) {
      attempts.push(`${via}:空正文`);
      return false;
    }
    if (looksLikeWall(content)) {
      attempts.push(`${via}:反爬/登录墙`);
      return false;
    }
    if (content.length < MIN_PAGE_CHARS) {
      attempts.push(`${via}:仅 ${content.length} 字，太薄`);
      return false;
    }
    if (!best || content.length > best.content.length) best = { via, title, content };
    return false;
  };

  // ① 搜索服务的正文抽取（质量最高，带标题与结构化处理）
  try {
    const data = await anySearchRequest("/v1/extract", { url: target });
    consider("anysearch", {
      title: data.title,
      content: data.content || data.markdown || data.text
    });
  } catch (error) {
    attempts.push(`anysearch:${error.message.slice(0, 40)}`);
  }

  // ② 直连抓 HTML
  if (!best) {
    try {
      consider("direct", await directFetchText(target));
    } catch (error) {
      attempts.push(`direct:${error.message.slice(0, 40)}`);
    }
  }

  // ③ 真浏览器兜底（慢 3-5 秒，只在前两步都不行时才用）
  const chromeExists = await fs.access(CHROME_BIN).then(() => true).catch(() => false);
  if (!best && allowChrome && chromeExists) {
    try {
      consider("chrome", await chromeFetchText(target));
    } catch (error) {
      attempts.push(`chrome:${error.message.slice(0, 40)}`);
    }
  }

  if (!best) {
    const error = new Error(
      `抓不到这个页面的正文（${attempts.join("；") || "未知原因"}）`
    );
    error.code = "FETCH_BLOCKED";
    error.attempts = attempts;
    throw error;
  }

  return {
    url: target,
    title: best.title || target,
    via: best.via,
    contentLength: best.content.length,
    content: best.content.slice(0, 14000)
  };
}

// 素材可蒸馏性预检：人物词条、新闻快讯这类叙述性内容里没有"可照做的方法"，
// 硬蒸只会得到一堆正确的废话。先判类型，再决定蒸不蒸。
export function assessMaterial(text) {
  const body = String(text || "").trim();
  if (body.length < 400) {
    return { ok: false, kind: "too-short", message: `素材只有 ${body.length} 字，太薄` };
  }
  // 用"密度"而不是"绝对次数"判断：短素材里出现 4 次方法词就已经很方法论了，
  // 而 1.7 万字的人物词条里出现 15 次也还是生平介绍。
  const methodWords =
    body.match(
      /步骤|流程|方法|原则|框架|清单|做法|实践|技巧|策略|模型|模板|检查表|复盘|规则|标准|自检|阶段|环节|要点|禁止|务必|必须|应当|建议|关键在于|否则/g
    ) || [];
  const seqHits =
    (body.match(/第[一二三四五六七八九][步稿条章]|[①②③④⑤]|^\s*\d+[.、)]/gm) || []).length;
  const density = (methodWords.length / Math.max(1, body.length)) * 1000 + seqHits * 1.5;
  const bioHits = (
    body.match(/出生于|生于|毕业于|代表作|生平|祖籍|逝世|曾任|获(得|奖)|年出生|字\s*\S+，|号\s*\S+/g) || []
  ).length;
  const newsHits = (body.match(/记者|报道|发布会|宣布|股价|涨幅|营收|同比|季度/g) || []).length;

  if (bioHits >= 4 && density < 6) {
    return {
      ok: false,
      kind: "biography",
      message: "这看起来是人物/词条介绍，通篇是生平与作品，没有可提炼的操作方法"
    };
  }
  if (density < 5) {
    return {
      ok: false,
      kind: newsHits > 3 ? "news" : "no-method",
      message: "素材里几乎没有方法、步骤、原则一类的可操作内容"
    };
  }
  return { ok: true, kind: "method", density: Number(density.toFixed(1)) };
}

const DOWNLOAD_DIR_NAME = "下载";

function guessExtension(url, contentType) {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  })();
  const fromPath = path.extname(pathname).replace(/^\./, "").toLowerCase();
  if (fromPath && fromPath.length <= 5) return fromPath;
  const type = String(contentType || "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("html")) return "html";
  if (type.includes("json")) return "json";
  if (type.includes("csv")) return "csv";
  if (type.includes("markdown")) return "md";
  if (type.includes("plain")) return "txt";
  if (type.includes("wordprocessingml")) return "docx";
  if (type.includes("msword")) return "doc";
  return "bin";
}

async function saveTextNote(dir, baseName, pageTitle, text, source) {
  const noteTitle = String(pageTitle || baseName).replace(/[-_]+/g, " ").trim() || "网络内容";
  let file = path.join(dir, `${safeFilename(baseName)}.md`);
  for (let i = 2; i < 50; i += 1) {
    try {
      await fs.access(file);
      file = path.join(dir, `${safeFilename(baseName)}-${i}.md`);
    } catch {
      break;
    }
  }
  const frontmatter = [
    "---",
    `title: ${noteTitle}`,
    `date: ${formatDateValue(new Date())}`,
    "domain: life",
    `source: ${source}`,
    "tags:",
    "  - 小满",
    "  - 网络下载",
    "---",
    ""
  ].join("\n");
  await fs.writeFile(file, frontmatter + text + "\n", "utf8");
  return {
    ok: true,
    saved: path.relative(vaultDir, file),
    title: noteTitle,
    chars: text.length,
    preview: text.slice(0, 200)
  };
}

export async function downloadUrlTool({ url, save_as }) {
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    throw new Error("缺少合法的下载地址（必须以 http:// 或 https:// 开头）");
  }
  const target = url.trim();
  const dir = path.join(vaultDir, "待蒸馏", DOWNLOAD_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const rawName =
    (save_as && String(save_as).trim()) ||
    decodeURIComponent(path.basename(new URL(target).pathname) || "")
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .slice(0, 80);

  let buffer = null;
  let contentType = "";
  let fetchError = "";
  try {
    const response = await fetch(target, {
      headers: { "User-Agent": FETCH_UA, Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    contentType = response.headers.get("content-type") || "";
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }

  if (!buffer) {
    // 直连被墙 / 有反爬时，退回搜索服务的正文抽取，至少还能拿到内容做蒸馏
    // 直连失败时不要只试一次抽取接口：走完整的抓取级联（抽取 → 直连 → 真浏览器），
    // 这样知乎/公众号这类站点也有机会拿到正文，而不是直接判死。
    const page = await fetchPageTool({ url: target }).catch(() => null);
    const extracted = String(page?.content || "").trim();
    if (!extracted) {
      const error = new Error(
        `抓不到这个网址的正文（${fetchError || "无法访问"}，几种抓取方式都没拿到内容）`
      );
      error.code = "FETCH_BLOCKED";
      throw error;
    }
    return await saveTextNote(dir, rawName || "网页内容", page?.title || "", extracted, target);
  }

  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error("文件超过 25MB，暂不自动下载（会让用户手动保存）");
  }
  const ext = guessExtension(target, contentType);
  let pageTitle = "";
  if (/html/i.test(contentType) || ext === "html") {
    const titleMatch = buffer.toString("utf8").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      pageTitle = decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim().slice(0, 60);
    }
  }
  const baseName = rawName || pageTitle || "网页内容";

  let text = "";
  if (["html", "htm"].includes(ext)) {
    text = htmlToText(buffer.toString("utf8"));
  } else if (
    ["txt", "md", "markdown", "json", "csv", "tsv", "xml"].includes(ext) ||
    /^text\//.test(contentType)
  ) {
    text = buffer.toString("utf8").trim();
  } else if (ext === "pdf") {
    const tmp = path.join(os.tmpdir(), `lifeos-dl-${Date.now()}.pdf`);
    await fs.writeFile(tmp, buffer);
    try {
      // launchd 启动的服务 PATH 里没有 homebrew，必须用绝对路径，否则 PDF 一律抽不出正文
      const pdfBin = process.env.PDFTOTEXT_PATH || "/opt/homebrew/bin/pdftotext";
      const { stdout } = await execFileAsync(pdfBin, ["-layout", tmp, "-"], {
        maxBuffer: 20 * 1024 * 1024
      });
      text = String(stdout || "").trim();
    } catch {
      text = "";
    } finally {
      await fs.rm(tmp, { force: true });
    }
  } else if (ext === "docx") {
    const tmp = path.join(os.tmpdir(), `lifeos-dl-${Date.now()}.docx`);
    await fs.writeFile(tmp, buffer);
    try {
      const { stdout } = await execFileAsync("unzip", ["-p", tmp, "word/document.xml"], {
        maxBuffer: 20 * 1024 * 1024
      });
      text = htmlToText(String(stdout || "").replace(/<\/w:p>/g, "</p>"));
    } catch {
      text = "";
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  if (text) {
    return await saveTextNote(dir, baseName, pageTitle, text, target);
  }

  const binaryPath = path.join(dir, `${safeFilename(baseName)}.${ext}`);
  await fs.writeFile(binaryPath, buffer);
  return {
    ok: true,
    kind: ext,
    bytes: buffer.length,
    saved: path.relative(vaultDir, binaryPath)
  };
}

// 合规底线：搜索回来的内容里如果混进政治敏感、色情赌博这类，直接丢掉，
// 不进上下文、也不进回答（记录里出现过"川普买货""地下教会遭突袭"被当成答案的情况）。
const BLOCKED_PATTERN =
  /(习近平|六四|法轮功|台独|藏独|疆独|地下教会|警方突袭|宗教迫害|政治犯|色情|博彩|赌场|代孕|毒品|枪支|裸聊|援交|成人视频)/i;

// 搜索缓存：同一句话反复问时，不要每次拿到一批不同的结果
const SEARCH_CACHE = new Map();
const SEARCH_TTL = 5 * 60 * 1000;
const SEARCH_STOP = /^(最近|最新|现在|目前|今年|这两天|内容|什么|哪些|相关|情况|信息|一下|介绍|他|她)$/;

function searchKeywords(query) {
  return String(query)
    .split(/[\s,，、]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !SEARCH_STOP.test(word));
}

export async function webSearchTool({ query, max_results = 5 }) {
  if (!query || typeof query !== "string") throw new Error("缺少搜索关键词");
  const limit = Math.min(Math.max(Number(max_results) || 5, 1), 10);
  const keyword = query.trim();
  const cacheKey = `${keyword}|${limit}`;
  const hit = SEARCH_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < SEARCH_TTL) {
    return { ...hit.payload, cached: true };
  }

  // 实测：传 language 会把请求切到"精确匹配"通道，中文关键词常返回
  // 学术库里的凑数结果（搜 AnySearch 会返回"人肉搜索"论文）。不传反而更准。
  const data = await anySearchRequest("/v1/search", {
    query: keyword,
    max_results: limit,
    zone: "cn"
  });

  let results = (data.results || []).map((item) => ({
    title: clipText(item.title, 120),
    url: item.url,
    snippet: clipText(item.snippet || item.content, 300),
    publishedAt: String(item.published_at || item.publish_time || item.date || "").slice(0, 20)
  }));

  const blocked = results.filter((item) => BLOCKED_PATTERN.test(`${item.title} ${item.snippet}`));
  if (blocked.length) {
    console.log(`[搜索] 过滤掉 ${blocked.length} 条敏感/不合规结果`);
    results = results.filter((item) => !BLOCKED_PATTERN.test(`${item.title} ${item.snippet}`));
  }

  // 相关性：结果里连关键词都不出现的，基本都是搜索服务凑数的
  const kws = searchKeywords(keyword);
  if (kws.length && results.length > 2) {
    const strict = results.filter((item) =>
      kws.some((word) => `${item.title}${item.snippet}`.includes(word))
    );
    if (strict.length >= 2) results = strict;
  }

  if (!results.length) {
    throw new Error("搜索没有返回可用结果（结果被过滤或确实没搜到），换更具体的关键词再试");
  }

  const payload = {
    query: keyword,
    resultCount: results.length,
    results: results.slice(0, limit)
  };
  SEARCH_CACHE.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

export async function writeSkillTool({ folder, title, content, minChars = 700 }) {
  if (!folder || typeof folder !== "string") throw new Error("缺少技能文件夹名");
  if (!title || typeof title !== "string") throw new Error("缺少技能标题");
  if (!content || typeof content !== "string") throw new Error("缺少技能内容");

  // —— 蒸馏质检：不合格的技能卡不许入库 ——
  // 之前出现过"六段各一句话"的空壳（约 670 字节、无原文依据、无可执行步骤），
  // 这种卡片还会被别名自动激活，把回答往套话上带，所以这里硬性拦下。
  const body = content.replace(/^---[\s\S]*?\n---\s*/, "").trim();
  const sections = ["R", "I", "A1", "A2", "E", "B"];
  const missingSections = sections.filter(
    (key) =>
      !new RegExp(
        `(^|\\n)\\s*(?:#{1,6}\\s*)?[-*]?\\s*${key}\\b[^\\n]{0,12}(触发|解释|案例|区分|执行|边界)`
      ).test(body)
  );
  const problems = [];
  if (body.length < minChars) problems.push(`正文只有 ${body.length} 字，至少 ${minChars} 字`);
  if (missingSections.length) problems.push(`缺少分段：${missingSections.join("/")}`);
  if (!/(步骤|第[一二三四五]步|①|1\.\s)/.test(body)) problems.push("没有可执行的步骤");
  if (!/(例如|比如|案例|当时|原文|书里|文章里)/.test(body)) problems.push("没有具体案例或原文依据");
  if (!/(不适用|别用|失败|反例|边界)/.test(body)) problems.push("没写清边界与反例");
  if (problems.length) {
    throw new Error(
      `技能卡质量不达标：${problems.join("；")}。请重写后再调用 write_skill：` +
        "每段至少 3-5 句，E 段要写成可直接照做的编号步骤，A1 必须引用原文里的真实案例，B 段写出什么情况下别用。"
    );
  }

  const skillDir = insideVault(path.join("agents", "skills", folder.trim()));
  if (!skillDir || path.basename(skillDir) !== folder.trim()) {
    throw new Error("技能文件夹名不合法");
  }
  const target = path.join(skillDir, "SKILL.md");
  try {
    await fs.access(target);
    throw new Error(
      `技能 ${folder} 已存在。如需更新请换一个文件夹名（如 ${folder}-v2），或让用户手动确认覆盖`
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(target, content.trim() + "\n", "utf8");
  return {
    ok: true,
    saved: path.relative(vaultDir, target),
    note: "技能已安装，下次对话自动生效"
  };
}

// ---------- 文件整理执行协议 ----------
// plan_file_ops 只生成并暂存方案（校验但不执行）；execute_file_ops 在用户确认后才真实执行。
// 安全边界：只允许用户主目录内的文件 move/rename；拒绝覆盖目标；单方案最多 20 条；30 分钟过期；绝不删除。
const pendingPlans = new Map();
let planSeq = 0;

function normalizeUserPath(raw) {
  const value = String(raw || "").trim().replace(/^~(?=\/|$)/, homeDir);
  return path.resolve(value);
}

function assertInsideHome(target) {
  if (!target.startsWith(homeDir + path.sep) && target !== homeDir) {
    throw new Error(`路径必须在用户主目录内：${target}`);
  }
}

// 模型常把目标路径的相对目录写丢（如 ~/Downloads/a.txt → ~/目标/a.txt），这里做归一兜底
async function resolveTargetPath(fromPath, toRaw) {
  const literal = normalizeUserPath(toRaw);
  const dirOf = (p) => path.dirname(p);
  const exists = async (p) => {
    try {
      const st = await fs.stat(p);
      return st.isDirectory();
    } catch {
      return false;
    }
  };
  if (await exists(dirOf(literal))) return literal;
  // 尝试：源文件所在目录 + 目标目录名
  const alt = path.join(dirOf(fromPath), path.basename(dirOf(literal)), path.basename(literal));
  if (await exists(dirOf(alt))) return alt;
  // 尝试：目标只有文件名（重命名场景）
  const alt2 = path.join(dirOf(fromPath), path.basename(literal));
  return alt2;
}

async function planFileOpsTool({ operations }) {
  const list = Array.isArray(operations) ? operations : [];
  if (!list.length) throw new Error("operations 不能为空");
  if (list.length > 20) throw new Error("单次方案最多 20 条操作，请分批生成多个方案");
  const checked = [];
  for (const op of list) {
    const action = op.action === "rename" ? "rename" : "move";
    const from = normalizeUserPath(op.from);
    const to = await resolveTargetPath(from, op.to);
    assertInsideHome(from);
    assertInsideHome(to);
    const fromStat = await fs.stat(from).catch(() => null);
    if (!fromStat) throw new Error(`源不存在：${op.from}`);
    if (fromStat.isDirectory()) throw new Error(`不支持移动整个文件夹（只支持单个文件）：${op.from}`);
    let targetExists = false;
    try {
      await fs.access(to);
      targetExists = true;
    } catch {}
    if (targetExists) throw new Error(`目标已存在，拒绝覆盖：${op.to}`);
    checked.push({
      action,
      from,
      to,
      fromShort: op.from,
      toShort: op.to,
      mtimeMs: fromStat.mtimeMs,
      size: fromStat.size
    });
  }
  planSeq += 1;
  const planId = `P${Date.now().toString(36)}-${planSeq}`;
  pendingPlans.set(planId, { ops: checked, createdAt: Date.now(), sessionId: taskContext.getStore()?.sessionId });
  for (const [id, plan] of pendingPlans) {
  if (Date.now() - plan.createdAt > 30 * 60 * 1000) pendingPlans.delete(id);
  }
  const pretty = (p) => p.replace(homeDir, "~");
  return {
    planId,
    total: checked.length,
    plan: checked.map(
      (op, i) =>
        `${i + 1}. [${op.action}] ${pretty(op.from)} → ${pretty(op.to)}（${(op.size / 1024).toFixed(0)}KB）`
    ),
    note:
      "方案已生成但【未执行】。必须把方案完整展示给用户，等用户明确回复确认并带方案 ID（如\"确认执行方案 ID\"）后，下一轮才能调用 execute_file_ops 并传入此 planId。用户没确认就执行算严重违规。"
  };
}

export async function executeFileOpsTool({ planId } = {}) {
  let plan = pendingPlans.get(String(planId || ""));
  if (!plan) {
    throw new Error("找不到待执行的方案（没有生成过、或已过期）。请先调用 plan_file_ops 生成方案");
  }
    if (!taskContext.getStore()?.confirmedPlan || taskContext.getStore().confirmedPlan !== planId || plan.sessionId !== taskContext.getStore()?.sessionId) throw new Error("方案尚未在当前会话明确确认");
  if (Date.now() - plan.createdAt > 30 * 60 * 1000) throw new Error("方案已过期");
  pendingPlans.delete(String(planId)); // 原子领取，避免重复执行
  const results = [];
  let executed = 0;
  for (const op of plan.ops) {
    checkTask();
    try {
      const current = await fs.stat(op.from);
      if (current.size !== op.size || current.mtimeMs !== op.mtimeMs) throw new Error("源文件已变化，请重新生成方案");
      assertInsideHome(await fs.realpath(op.from));
      assertInsideHome(await fs.realpath(path.dirname(op.to)));
      let targetExists = false;
      try {
        await fs.access(op.to);
        targetExists = true;
      } catch {}
      if (targetExists) {
        results.push({ ok: false, from: op.fromShort, to: op.toShort, error: "目标已出现，跳过以防覆盖" });
        continue;
      }
      await fs.mkdir(path.dirname(op.to), { recursive: true });
      await fs.rename(op.from, op.to);
      const pretty = (p) => p.replace(homeDir, "~");
      results.push({ ok: true, from: pretty(op.from), to: pretty(op.to) });
      executed += 1;
    } catch (error) {
      results.push({ ok: false, from: op.fromShort, to: op.toShort, error: error.message });
    }
  }
  pendingPlans.delete(String(planId));
  if (process.env.NODE_ENV !== "test") {
  await fs.mkdir(path.join(vaultDir, ".operations"), { recursive: true });
  await fs.appendFile(path.join(vaultDir, ".operations", "journal.jsonl"), JSON.stringify({planId, sessionId:plan.sessionId,at:new Date().toISOString(),results}) + "\n");
  }
  return { executed, total: plan.ops.length, results };
}

export const tools = [
  {
    name: "plan_file_ops",
    label: "生成文件整理方案",
    danger: "write",
    description:
      "当用户要求整理/移动/重命名文件时，先用本工具生成方案（只校验和暂存，不执行任何改动）。方案生成后必须展示给用户并等确认",
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          description: "操作列表，每项 {action: 'move'|'rename', from: '原路径', to: '新路径'}，路径用 ~/ 开头或纯文件夹名",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["move", "rename"] },
              from: { type: "string" },
              to: { type: "string" }
            },
            required: ["action", "from", "to"]
          }
        }
      },
      required: ["operations"]
    },
    run: planFileOpsTool
  },
  {
    name: "execute_file_ops",
    label: "执行已确认的整理方案",
    danger: "write",
    description:
      "执行之前生成的文件整理方案。只有用户在对话中明确确认后才能调用，必须传入 plan_file_ops 返回的 planId",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "plan_file_ops 返回的方案 ID" }
      },
      required: ["planId"]
    },
    run: executeFileOpsTool
  },
  {
    name: "write_skill",
    label: "安装新技能",
    danger: "write",
    description:
      "把蒸馏出的方法论写成 SKILL.md 存入技能库（agents/skills/ 目录），存完后日常对话即可调用。只新增，绝不覆盖已有技能",
    parameters: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "技能文件夹名，简短英文或拼音，如 positioning"
        },
        title: { type: "string", description: "技能标题（会写进 frontmatter name）" },
        content: {
          type: "string",
          description:
            "SKILL.md 完整内容。格式要求：frontmatter 必须用 --- 包裹（不要用 ```yaml 代码块），包含 name、description、aliases 三个字段；正文用 Markdown"
        }
      },
      required: ["folder", "title", "content"]
    },
    run: writeSkillTool
  },
  {
    name: "web_search",
    label: "联网搜索",
    danger: "read",
    description:
      "联网搜索最新信息。当用户问最新消息、新闻、现状、价格、版本、天气等需要联网的问题时使用。返回标题、摘要和链接",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，尽量具体" },
        max_results: { type: "number", description: "返回结果数，默认 5" }
      },
      required: ["query"]
    },
    run: webSearchTool
  },
  {
    name: "fetch_page",
    label: "读取网页全文",
    danger: "read",
    description:
      "读取某个网页的完整正文（Markdown 文本）。用于搜索结果里某条链接需要深入了解时，或用户直接给了一个网址让你读",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "网页地址，以 https:// 开头" }
      },
      required: ["url"]
    },
    run: fetchPageTool
  },
  {
    name: "download_url",
    label: "下载网页或文件",
    danger: "write",
    description:
      "把网络上的网页/PDF/Word/文本下载下来并抽取正文，存进「待蒸馏/下载」变成一篇笔记。用户给链接说\"下载\"、\"存下来\"、\"把这篇蒸馏成技能\"时使用；返回的 saved 就是可用 read_note 读取的笔记 id",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "下载地址，以 https:// 开头" },
        save_as: { type: "string", description: "保存的文件名（可选，不传则用网址里的名字）" }
      },
      required: ["url"]
    },
    run: downloadUrlTool
  },
  {
    name: "list_notes",
    label: "翻看笔记列表",
    danger: "read",
    description: "列出 vault 笔记库里的笔记（标题、路径、日期），最多返回 40 篇",
    parameters: { type: "object", properties: {} },
    run: listNotesTool
  },
  {
    name: "read_note",
    label: "阅读笔记",
    danger: "read",
    description: "按 id 读取一篇笔记的正文内容",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "笔记 id，即相对 vault 的路径，来自 list_notes 结果" },
        offset: {
          type: "number",
          description: "从第几个字符开始读，默认 0；返回的 nextOffset 不为 null 时，用它继续读下一段"
        }
      },
      required: ["id"]
    },
    run: readNoteTool
  },
  {
    name: "write_note",
    label: "写一条新笔记",
    danger: "write",
    description:
      "在 vault 的「00 收件箱」新建一篇笔记（只新增，绝不覆盖已有文件）。用于用户说\"记一下/写个笔记\"时",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "笔记标题" },
        content: { type: "string", description: "笔记正文（Markdown）" }
      },
      required: ["title", "content"]
    },
    run: writeNoteTool
  },
  {
    name: "scan_directory",
    label: "扫描文件夹大文件",
    danger: "read",
    description:
      "扫描用户主目录下某个文件夹，返回最大的若干个文件（用于磁盘清理建议）。只读，不改动任何文件。directory 参数请传 ~ 开头路径或纯文件夹名（如 ~/Downloads、Downloads），不要传 / 开头的系统路径",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "要扫描的文件夹，格式如 ~/Downloads 或 Downloads" },
        top: { type: "number", description: "返回前几个最大的文件，默认 15" }
      },
      required: ["directory"]
    },
    run: scanDirectoryTool
  }
];

export function pendingPlanCount() {
  return pendingPlans.size;
}

export function getToolSchemas() {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

export function findTool(name) {
  return tools.find((tool) => tool.name === name) || null;
}
