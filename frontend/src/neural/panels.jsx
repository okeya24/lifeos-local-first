import React, {useEffect, useRef, useState, useCallback} from 'react';
import {Icon} from './icons';
import {ProgressWorkbench} from './ProgressWorkbench';

// —— 数据轮询 hooks ——
function usePoll(url, interval, initial = null) {
  const [data, setData] = useState(initial);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url);
        if (res.ok && alive) setData(await res.json());
      } catch {}
    };
    load();
    const timer = setInterval(load, interval);
    return () => { alive = false; clearInterval(timer); };
  }, [url, interval]);
  return data;
}

const upDown = (v, total) => {
  if (!total) return {icon: '－', cls: '', text: '起步中'};
  if (v > 0) return {icon: '↑', cls: 'up', text: '上升'};
  if (v < 0) return {icon: '↓', cls: 'down', text: '回落'};
  return {icon: '→', cls: '', text: '平稳'};
};

// —— 1号框：系统监控 ——
function SystemBox({act}) {
  const sys = usePoll('/api/system', 4000);
  const working = Boolean(act && act.state !== 'idle');
  if (!sys) return <section className={`pbox pbox-sys glass ${working ? 'is-live' : ''}`} aria-label="系统状态"><header><Icon name="pulse" size={14}/><h3>系统 <em>System</em></h3><span className="pbox-live"/></header><p className="pbox-empty">连接中…</p></section>;
  const mem = sys.memory || {};
  const disks = sys.disks || [];
  const ai = sys.aiServices || {};
  const aiNames = (ai.services || []).map(s => s.name);
  const extra = (ai.ollamaModels || []).length + (ai.dockerContainers || []).length;
  return <section className={`pbox pbox-sys glass ${working ? 'is-live' : ''}`} aria-label="系统状态">
    <header><Icon name="pulse" size={14}/><h3>系统 <em>System</em></h3><span className="pbox-live" title={working ? act.label : ''}/><span className="pbox-chip">{sys.cpuModel || `${sys.cpuCores} 核`}</span></header>
    <div className="meter-row"><span>CPU</span><div className="meter"><i style={{width: `${Math.min(sys.cpuPercent, 100)}%`}}/></div><b>{sys.cpuPercent}%</b></div>
    <div className="meter-row"><span>内存</span><div className="meter"><i style={{width: `${mem.usedPercent || 0}%`}}/></div><b>{mem.usedGb}/{mem.totalGb}G</b></div>
    {disks.map(d => <div key={d.mount} className="meter-row"><span>{d.name === '外接硬盘 MacData' ? '外接' : '硬盘'}</span><div className="meter"><i style={{width: `${d.usedPercent}%`}}/></div><b>{d.usedGb}/{d.totalGb}G</b></div>)}
    <div className="ai-services" title={aiNames.concat(ai.ollamaModels || []).join(' · ')}>
      {(ai.services || []).length
        ? <>{(ai.services || []).map(s => <span key={s.port + s.name} className="ai-dot on" title={`${s.name}（${s.desc}）运行中`}>{s.name}</span>)}
            {(ai.ollamaModels || []).slice(0, 2).map(m => <span key={m} className="ai-dot model" title="Ollama 已装模型">{m}</span>)}
            {extra > 2 && <span className="ai-dot" title="更多模型/容器">+{extra - 2}</span>}</>
        : <span className="ai-dot off">AI 服务全部离线</span>}
    </div>
  </section>;
}

// —— 2号框：生活面板（原面板信息浓缩 + 蒸馏进度）——
function LifeBox({act}) {
  const [workbench,setWorkbench] = useState(false);
  const life = usePoll('/api/lifeos/overview', 15000);
  const distilling = Boolean(act && act.state !== 'idle' && act.mode === 'distill');
  return <section className={`pbox pbox-life glass ${distilling ? 'is-live' : ''}`} aria-label="生活面板">
    <header><Icon name="spark" size={14}/><h3>今日 LifeOS <em>Today</em></h3>{life && <span className="pbox-chip">{life.noteCount} 篇</span>}</header>
    {!life && <p className="pbox-empty">连接中…</p>}
    {life && <>
      <div className="life-metrics">
        {life.metrics.slice(0, 3).map(m => <div key={m.label}><b>{m.value}</b><span>{m.label}</span></div>)}
      </div>
      <div className="life-section">
        <h4>今天的轨迹</h4>
        {(life.events || []).slice(0, 3).map((e, i) => <div key={i} className="life-event"><time>{e.time}</time><div><strong>{e.title}</strong><span>{e.detail}</span></div></div>)}
        {(life.events || []).length === 0 && <p className="pbox-empty">今天还没有记录</p>}
      </div>
      <div className="life-section">
        <h4>最近资料</h4>
        {(life.recentNotes || []).slice(0, 2).map(n => <div key={n.id} className="life-note"><strong>{n.title}</strong><span>{n.date}</span></div>)}
      </div>
      <div className={`distill-bar ${distilling ? 'is-live' : ''}`}>
        <Icon name="spark" size={12}/>
        <span>{distilling ? `蒸馏中 · ${act.label || '处理中'}` : `蒸馏库 ${life.distill?.skillCount ?? 0} 个技能`}</span>
        <i/>
        <span>待蒸 {life.distill?.pending ?? 0} 篇</span>
      </div>
      <button type="button" onClick={()=>setWorkbench(true)}>打开蒸馏工作台 · Distill</button>
    </>}
    {workbench && <ProgressWorkbench mode="distill" onClose={()=>setWorkbench(false)}/>}
  </section>;
}

// 把回复里的网址变成可点链接（之前是一坨纯文本，给了链接也点不动）
function linkify(text) {
  const raw = String(text || '');
  return raw.split(/(https?:\/\/[^\s<>()）)】」，。]+)/g).map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer">{part.length > 56 ? part.slice(0, 56) + '…' : part}</a>
      : part
  );
}

// —— 3号框：与小满聊天（连 LifeOS /api/chat，ndjson 流式）——
// 可拖拽放大：把手在标题栏右侧，向上拖变高、向右拖变宽，尺寸存本地；双击把手还原默认
const DEFAULT_CHAT = {w: 330, h: 400};
function ChatBox() {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState([]);
  const [histDate, setHistDate] = useState('');
  const [days, setDays] = useState([]);
  const [showDays, setShowDays] = useState(false);
  const [size, setSize] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('lifeos-chat-size') || 'null');
      if (raw && raw.w >= 300 && raw.h >= 260) return raw;
    } catch {}
    return null;
  });
  const sizeRef = useRef(size);
  const drag = useRef(null);
  const listRef = useRef(null);
  const scrollDown = () => { requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }); };
  useEffect(scrollDown, [history, tools]);

  // 打开页面时把这天之前的对话捞回来（服务端已落盘，刷新不再失忆）
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/history').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/history/dates').then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(([h, d]) => {
      if (!alive) return;
      if (h && Array.isArray(h.messages) && h.messages.length) {
        setHistory(h.messages.slice(-60).map(m => ({ role: m.role, content: m.content })));
      }
      if (h && h.date) setHistDate(h.date);
      if (d && Array.isArray(d.days)) setDays(d.days);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 翻看以前某一天：记录按天存成 jsonl，这里按日期换一份
  const loadDay = async day => {
    setShowDays(false);
    if (day === histDate) return;
    try {
      const r = await fetch(`/api/history?date=${encodeURIComponent(day)}`);
      const d = await r.json();
      setHistory((d.messages || []).slice(-60).map(m => ({ role: m.role, content: m.content })));
      setHistDate(d.date || day);
      requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = 0; });
    } catch {}
  };

  const startDrag = e => {
    const box = e.currentTarget.closest('.pbox');
    if (!box) return;
    const r = box.getBoundingClientRect();
    drag.current = {x: e.clientX, y: e.clientY, w: r.width, h: r.height};
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    document.body.classList.add('chat-resizing');
  };
  const moveDrag = e => {
    const d = drag.current;
    if (!d) return;
    const maxW = Math.max(330, Math.min(860, window.innerWidth - 60));
    const maxH = Math.max(340, window.innerHeight - 130);
    const next = {
      w: Math.round(Math.min(maxW, Math.max(300, d.w + (e.clientX - d.x)))),
      h: Math.round(Math.min(maxH, Math.max(280, d.h - (e.clientY - d.y))))
    };
    sizeRef.current = next;
    setSize(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('chat-resizing');
    try { if (sizeRef.current) localStorage.setItem('lifeos-chat-size', JSON.stringify(sizeRef.current)); } catch {}
  };
  const resetSize = () => {
    sizeRef.current = null;
    setSize(null);
    try { localStorage.removeItem('lifeos-chat-size'); } catch {}
  };

  // 窗口变小或换屏幕时，把已放大的聊天框收回可视范围
  useEffect(() => {
    const onResize = () => {
      if (!sizeRef.current) return;
      const maxW = Math.max(330, Math.min(860, window.innerWidth - 60));
      const maxH = Math.max(340, window.innerHeight - 130);
      const w = Math.min(sizeRef.current.w, maxW);
      const h = Math.min(sizeRef.current.h, maxH);
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = {w, h};
      setSize({w, h});
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setTools([]);
    setHistory(h => [...h, {role: 'user', content: text}]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: text, history: history.slice(-8)})
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      // 流式回复是一小块一小块来的，逐块 setState 等于每来几个字就把整个聊天列表重算一遍
      // （每条消息都要跑 linkify 正则），消息一多就卡。这里合并到每帧最多刷一次。
      let frame = 0;
      const flushAnswer = () => {
        frame = 0;
        setHistory(h => {
          const copy = [...h];
          if (copy[copy.length - 1]?.role === 'assistant') {
            copy[copy.length - 1] = {role: 'assistant', content: answer};
          } else {
            copy.push({role: 'assistant', content: answer});
          }
          return copy;
        });
      };
      const paint = () => { if (!frame) frame = requestAnimationFrame(flushAnswer); };
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'delta') { answer += event.content; paint(); }
          else if (event.type === 'notice') setTools(t => [...t.slice(-2), event.message]);
          else if (event.type === 'error') { answer += `\n[出错了：${event.message}]`; paint(); }
        }
      }
      if (frame) { cancelAnimationFrame(frame); flushAnswer(); }
    } catch (error) {
      setHistory(h => [...h, {role: 'assistant', content: `连接 LifeOS 服务失败：${error.message}`}]);
    } finally {
      setBusy(false);
      setTools([]);
    }
  }, [input, busy, history]);

  const todayStr = new Date().toLocaleDateString('en-CA');
  const isToday = !histDate || histDate === todayStr;

  return <section className={`pbox pbox-chat glass ${busy ? 'is-live' : ''} ${size ? 'is-resized' : ''}`} aria-label="与小满聊天"
    style={size ? {'--chat-w': `${size.w}px`, '--chat-h': `${size.h}px`} : undefined}>
    <header><Icon name="agent" size={14}/><h3>小满 <em>Companion</em></h3>
      <button type="button" className={`pbox-chip chat-days-btn ${busy ? 'busy' : ''}`}
        onClick={() => setShowDays(v => !v)} title="翻看以往的对话（按天存）">
        {busy ? '思考中…' : `${isToday ? '今天' : histDate.slice(5)} ${history.length}`}
      </button>
      <span className="chat-grip" role="separator" aria-label="拖动调整聊天框大小" title="拖动调大小 · 双击还原默认"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        onDoubleClick={resetSize}/>
    </header>
    {showDays && <div className="chat-days" role="menu">
      {days.length === 0 && <p>还没有更早的记录</p>}
      {days.map(d => <button type="button" key={d.date} className={d.date === histDate ? 'on' : ''}
        onClick={() => loadDay(d.date)}>{d.date}<span>{d.count} 条</span></button>)}
    </div>}
    <div className="chat-list" ref={listRef}>
      {!isToday && <div className="chat-archived">正在看 {histDate} 的记录<button type="button" onClick={() => loadDay(todayStr)}>回到今天</button></div>}
      {history.length === 0 && <p className="chat-hello">我是小满，你的靠谱损友。<br/>让我查笔记、扫文件、记东西、搜时事，直接说。</p>}
      {history.map((msg, i) => (
        <div key={i} className={`chat-msg ${msg.role}`}>
          <p>{linkify(msg.content)}</p>
        </div>
      ))}
      {tools.length > 0 && <div className="chat-tools">{tools[tools.length - 1]}…</div>}
    </div>
    <form className="chat-input" onSubmit={e => { e.preventDefault(); send(); }}>
      <input value={input} onChange={e => setInput(e.target.value)}
        placeholder={!isToday ? '回到今天才能继续聊' : busy ? '小满正在忙…' : '说点什么…'}
        disabled={busy || !isToday} aria-label="对话输入"/>
      <button type="submit" disabled={busy || !isToday || !input.trim()} aria-label="发送"><Icon name="send" size={15}/></button>
    </form>
  </section>;
}

// —— 4号框：行动轨迹（最近 14 天记录数）——
function GrowthBox() {
  const [workbench,setWorkbench] = useState(false);
  const data = usePoll('/api/lifeos/growth', 30000);
  if (!data) return <section className="pbox pbox-growth glass" aria-label="行动轨迹"><header><Icon name="pulse" size={14}/><h3>行动轨迹 <em>Actions</em></h3></header><p className="pbox-empty">连接中…</p></section>;
  const days = data.days || [];
  const max = Math.max(...days.map(d => d.count), 1);
  const W = 260, H = 64, pad = 4;
  const step = (W - pad * 2) / Math.max(days.length - 1, 1);
  const pts = days.map((d, i) => [pad + i * step, H - pad - (d.count / max) * (H - pad * 2)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1]?.[0] || pad},${H - pad} L${pad},${H - pad} Z`;
  const trend = {cls:"",icon:"",text:data.totals?.practice ? "实践记录" : "尚未记录实践"};
  return <section className="pbox pbox-growth glass" aria-label="行动轨迹">
    <header><Icon name="pulse" size={14}/><h3>行动轨迹 <em>Actions</em></h3><span className={`pbox-chip ${trend.cls}`}>{trend.icon} {trend.text}</span></header>
    <svg viewBox={`0 0 ${W} ${H}`} className="growth-chart" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecd9a6" stopOpacity=".35"/>
          <stop offset="1" stopColor="#ecd9a6" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#growth-fill)"/>
      <path d={line} fill="none" stroke="#ecd9a6" strokeWidth="1.6" strokeLinecap="round"/>
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 2.6 : 1.6} fill={i === pts.length - 1 ? '#fff' : '#ecd9a6'}/>)}
    </svg>
    <div className="growth-foot">
      <span>近 14 天实践 <b>{data.totals?.practice || 0}</b> · 成果 <b>{data.totals?.outcome || 0}</b></span>
      <span>{days[0]?.date.slice(5)} — {days[days.length - 1]?.date.slice(5)}</span>
    </div>
    <div className="growth-foot"><span>积累 {data.totals?.accumulation || 0} · 导入 {data.totals?.imported || 0}</span><button onClick={()=>setWorkbench(true)}>登记／查看证据</button></div>
    <p className="pbox-empty">曲线表示实践次数，不代表能力评分。</p>
    {workbench && <ProgressWorkbench mode="actions" onClose={()=>setWorkbench(false)}/>}
  </section>;
}

// —— 组合：四角玻璃浮层 ——
export function Panels({life, act}) {
  return <>
    <div className="panels panels-tl"><SystemBox act={act}/></div>
    <div className="panels panels-tr"><LifeBox act={act}/></div>
    <div className="panels panels-bl"><ChatBox/></div>
    <div className="panels panels-br"><GrowthBox/></div>
    {act && act.state !== 'idle' && <div className={`agent-toast glow-red ${act.mode === 'distill' ? 'is-distill' : ''}`} aria-live="polite"><Icon name="agent" size={13}/><span>{act.label || '小满工作中'}</span></div>}
  </>;
}
