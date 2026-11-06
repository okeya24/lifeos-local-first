import { chatOnce } from "./providers/zhipu.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { vaultDir } from "./vaultNotes.mjs";

// 蒸馏流水线（服务端确定性执行）
// 之前把整个蒸馏交给模型"自己决定调不调工具"，实测经常是：模型把技能卡直接写在聊天里，
// 一个字都没入库，用户以为蒸好了。这里改成：服务端读素材 → 生成 → 质检 → 落盘，
// 工具调用不再依赖模型自觉。

export { startDistill as runDistill } from './distillWorkflow.mjs';

// 素材不适合蒸馏时的降级路线：不白跑一趟，给一份能用的结构化摘要并存成笔记。
// 用户的真实诉求是"这个链接里的东西我能不能用上"，蒸馏只是其中一种用法。
const SUMMARY_PROMPT = `你是资料整理助手。用户拿来一份网络素材，但它更接近人物介绍/新闻/背景资料，里面没有可照做的方法。
请输出一份中文摘要，格式：
第一行：一句话说清这份材料是什么、关于谁。
然后 4-6 条要点，用「- 」开头，每条都要有具体事实（人名、时间、数字、观点原话），不要写"影响深远""意义重大"这类空话。
最后一段以「如果想从里面学到方法」开头，指出材料里哪一段最接近方法论、可以怎么追问。
不要复述标题，不要写"综上所述"，600-900 字，只输出正文。`;

function todayString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export async function summarizeMaterial({ source, title = "", onNotice }) {
  const material = String(source || "").trim();
  if (material.length < 400) {
    throw new Error("素材太短，读不出内容。换一个链接，或把正文贴给我");
  }
  if (onNotice) await onNotice("这份不像方法论，先做一份摘要");
  const reply = await chatOnce({
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      {
        role: "user",
        content: `素材标题：${title || "未命名"}\n\n素材正文：\n${material.slice(0, 14000)}`
      }
    ],
    temperature: 0.3
  });
  const body = String(reply.content || "").trim();
  if (body.length < 200) throw new Error("摘要没生成出来，素材可能太零碎");

  const inbox = path.join(vaultDir, "00 收件箱");
  await fs.mkdir(inbox, { recursive: true });
  const baseName = (title || "网络素材").replace(/[\\/:*?"<>|#]/g, "-").replace(/\s+/g, "-").slice(0, 50);
  let file = path.join(inbox, `${baseName}-摘要.md`);
  for (let i = 2; i < 40; i += 1) {
    try {
      await fs.access(file);
      file = path.join(inbox, `${baseName}-摘要-${i}.md`);
    } catch {
      break;
    }
  }
  const note = `---\ntitle: ${title || "网络素材"}·摘要\ndate: ${todayString()}\ndomain: life\ntags:\n  - 小满\n  - 网络摘要\n---\n\n${body}\n`;
  await fs.writeFile(file, note, "utf8");
  return {
    ok: true,
    saved: path.relative(vaultDir, file),
    chars: body.length,
    content: body
  };
}
