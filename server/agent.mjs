import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatOnce } from "./providers/zhipu.mjs";
import { getToolSchemas, findTool } from "./tools.mjs";

const MAX_ROUNDS = 4;

// 防滥用闸门：联网类工具每次对话最多调用次数
const TOOL_BUDGETS = { web_search: 2, fetch_page: 2 };

// —— 活动状态（供神经看板的 AI 工作台水母读取）——
// state: idle | thinking | tool | done
// 只要 state 不是 idle，看板上就整体转为红色：蒸馏、聊天、工具调用都算"在干活"
export const activity = {
  state: "idle",
  mode: "chat", // 当前干的是哪类活：chat | distill | tools
  tool: null, // 工具标识（read_note / web_search / write_note ...）
  color: "red", // 工作态统一红色，空闲时由前端恢复原色
  label: "", // 展示文案（"正在翻看笔记列表"）
  since: Date.now(),
  stats: { day: "", toolCalls: 0, tasks: 0, lastTool: "" } // 今日工作量（AI 工作台水母显示）
};

// 今日工作量落盘：服务重启后不清零，AI 工作台始终显示真实的当天数据
const STATS_FILE = fileURLToPath(new URL("../vault/.activity-stats.json", import.meta.url));
const todayStr = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

try {
  const saved = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  if (saved && saved.day === todayStr()) {
    activity.stats = {
      day: saved.day,
      toolCalls: Number(saved.toolCalls) || 0,
      tasks: Number(saved.tasks) || 0,
      lastTool: saved.lastTool || ""
    };
  }
} catch {
  // 首次运行没有存档，忽略
}

let saveTimer = null;
function saveStats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
      fs.writeFileSync(STATS_FILE, JSON.stringify(activity.stats));
    } catch {
      // 落盘失败不影响主流程
    }
  }, 800);
  if (saveTimer.unref) saveTimer.unref();
}

function bumpStats(field) {
  const today = todayStr();
  if (activity.stats.day !== today) {
    activity.stats = { day: today, toolCalls: 0, tasks: 0, lastTool: activity.stats.lastTool };
  }
  activity.stats[field] += 1;
  saveStats();
}

// 每次对话都算一次工作任务（供聊天路由调用）
export function countTask() {
  bumpStats("tasks");
}

function setActivity(state, tool = null, label = "", color = "red", mode = null) {
  activity.state = state;
  activity.tool = tool;
  activity.label = label;
  activity.color = color;
  activity.since = Date.now();
  if (mode) activity.mode = mode;
  if (tool) activity.stats.lastTool = tool;
}

// 开始一段工作（聊天 / 蒸馏 / 其它）——看板立刻变红
export function beginActivity(mode = "chat", label = "对话中") {
  setActivity("thinking", null, label, "red", mode);
}

// 一段工作收尾：先保持几秒红色"完成"态，再回到空闲原色
export function endActivity(mode = null, holdMs = 2600) {
  setActivity("done", null, "完成", "red", mode);
  setTimeout(() => {
    if (activity.state === "done") setActivity("idle", null, "");
  }, holdMs);
}

const WORK_COLOR = "red";

export async function runAgentLoop({
  messages,
  signal,
  temperature = 0.4,
  onNotice,
  maxRounds = MAX_ROUNDS,
  mode = "chat"
}) {
  const convo = [...messages];
  const toolSchemas = getToolSchemas();
  const budget = { ...TOOL_BUDGETS };
  setActivity("thinking", null, mode === "distill" ? "蒸馏中" : "思考中", WORK_COLOR, mode);
  for (let round = 0; round < maxRounds; round += 1) {
    signal?.throwIfAborted();
    const reply = await chatOnce({
      signal,
      messages: convo,
      tools: toolSchemas,
      temperature
    });

    const toolCalls = Array.isArray(reply.tool_calls) ? reply.tool_calls : [];
    if (toolCalls.length === 0) {
      setActivity("done", null, "完成", WORK_COLOR, mode);
      setTimeout(() => {
        if (activity.state === "done") setActivity("idle", null, "");
      }, 6000);
      return typeof reply.content === "string" ? reply.content : "";
    }

    convo.push({
      role: "assistant",
      content: reply.content || "",
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      signal?.throwIfAborted();
      const tool = findTool(call.function?.name);
      let result;
      if (!tool) {
        result = { error: `未知工具：${call.function?.name}` };
      } else if (budget[tool.name] !== undefined && budget[tool.name] <= 0) {
        result = {
          error: `工具 ${tool.name} 本次对话调用次数已达上限，请基于已有信息直接回答`
        };
      } else {
        if (budget[tool.name] !== undefined) budget[tool.name] -= 1;
        try {
          const args = call.function?.arguments
            ? JSON.parse(call.function.arguments)
            : {};
          if (onNotice) {
            await onNotice(`正在${tool.label}`);
          }
          setActivity(
            "tool",
            tool.name,
            `正在${tool.label}`,
            WORK_COLOR,
            mode
          );
          result = (await tool.run(args)) ?? { ok: true };
          bumpStats("toolCalls");
          if (result && result.error) {
            console.log(`[工具] ${tool.name} 失败：${String(result.error).slice(0, 160)}`);
          } else {
            console.log(`[工具] ${tool.name} 完成`);
          }
          setActivity("thinking", null, "整理结果", WORK_COLOR, mode);
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 4000)
      });
    }
  }

  signal?.throwIfAborted();
  const finalReply = await chatOnce({
    signal,
    messages: [
      ...convo,
      {
        role: "user",
        content: "工具调用轮次已达上限，请直接基于已获得的信息回答，不要再调用工具。"
      }
    ],
    temperature
  });
  return typeof finalReply.content === "string" ? finalReply.content : "";
}
