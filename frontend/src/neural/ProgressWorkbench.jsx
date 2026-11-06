import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
async function api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'请求失败');return d;}
const levels={learned:'已学习',guided:'能按步骤完成',independent:'能独立完成',transfer:'能解释与迁移'};
const label={extracting:'提取中／可续跑',candidates:'候选待筛选',draft:'草稿待试跑',tested:'试跑待验收',enabled:'已启用',needs_review:'待核查',candidate:'有原文依据'};
export function ProgressWorkbench({mode,onClose}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notes,setNotes]=useState([]),[jobs,setJobs]=useState([]),[job,setJob]=useState(null),[selected,setSelected]=useState([]),[report,setReport]=useState(null);
 const [purpose,setPurpose]=useState(''),[source,setSource]=useState(''),[title,setTitle]=useState(''),[noteId,setNoteId]=useState('');
 const [input,setInput]=useState(''),[expected,setExpected]=useState(''),[boundaryInput,setBoundaryInput]=useState(''),[feedback,setFeedback]=useState('');
 const [type,setType]=useState('practice'),[date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())),[skillId,setSkillId]=useState(''),[level,setLevel]=useState('');
 async function refresh(){const [n,j,r]=await Promise.all([api(mode==='distill'?'/api/distill/materials':'/api/notes'),api('/api/distill/jobs'),api('/api/lifeos/growth')]);setNotes(n);setJobs(j);setReport(r);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
 async function run(fn){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const picker=<label>证据或素材笔记<select value={noteId} onChange={e=>setNoteId(e.target.value)}><option value="">选择笔记</option>{notes.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label>;
 return createPortal(<div className="progress-overlay"><section className="progress-workbench glass" role="dialog" aria-modal="true" aria-label={mode==='distill'?'蒸馏工作台':'行动与证据'}><header><h2>{mode==='distill'?'蒸馏工作台 · Distill':'行动与证据 · Actions'}</h2><button disabled={busy} onClick={onClose}>关闭</button></header><p role="status">{busy?'正在处理，请勿重复提交…':error}</p>
 {mode==='actions'?<>
 <p>记录真实完成的实践或成果，必须关联证据笔记。导入与积累分开统计，不评综合成长分。</p>
 <form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/api/lifeos/actions',{type,title,noteId,date,skillId,level});setTitle('');});}}>
 <label>类型<select value={type} onChange={e=>setType(e.target.value)}><option value="practice">实践：完成练习／应用方法</option><option value="outcome">成果：作品／解决问题／验收完成</option></select></label>
 <label>完成事项<input required value={title} onChange={e=>setTitle(e.target.value)}/></label><label>完成日期<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>{picker}
 <label>能力或技能名称（可选）<input value={skillId} onChange={e=>setSkillId(e.target.value)}/></label>
 <label>本次证据支持的阶段<select value={level} onChange={e=>setLevel(e.target.value)}><option value="">不登记阶段</option><option value="learned">已学习</option><option value="guided">能按步骤完成</option><option value="independent">能独立完成</option><option value="transfer">能解释与迁移</option></select></label>
 <button disabled={busy||!noteId}>确认登记</button></form>
 <h3>能力阶段（你确认的最新证据）</h3>{report?.stages?.map(s=><p key={s.skillId}>{s.skillId}：{levels[s.level]} · {s.date} · {s.noteId}</p>)}
 <h3>最近 14 天证据</h3>{report?.evidence?.map(e=><article key={e.id}><strong>{e.date} · {e.type==='practice'?'实践':'成果'} · {e.title}</strong><p>证据：{e.noteId}{e.skillId?` · ${e.skillId}`:''}{e.level?` · ${levels[e.level]}`:''}</p><details><summary>阅读证据</summary><pre>{notes.find(n=>n.id===e.noteId)?.body||'原笔记已移动或归档，请在资料库查找。'}</pre></details></article>)}
 <p>无明确创建日期的资料：{report?.unknownDate||0} 篇，未推算为新增。</p>
 </>:<>
 <p>全过程：用途 → 全文分块 → 候选与来源 → 草稿 → 真实任务及边界试跑 → 人工验收启用。模型试跑不代表外部操作已执行。</p>
 <details open={!job}><summary>开始或续跑提取</summary><form onSubmit={e=>{e.preventDefault();void run(async()=>setJob(await api('/api/distill/jobs',{title,purpose,noteId,source})));}}>
 <label>用途（必填）<input required value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="例如：完成第一个 RAG 项目"/></label>{picker}
 {!noteId&&<><label>素材标题<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>完整正文<textarea required value={source} onChange={e=>setSource(e.target.value)}/></label></>}
 <button disabled={busy||(!noteId&&!source.trim())}>提取候选／续跑</button></form></details>
 <div className="workflow-jobs">{jobs.map(j=><button disabled={busy} key={j.id} onClick={()=>void run(async()=>{const d=await api('/api/distill/jobs/'+j.id);setJob(d);setSelected(d.selected||[]);setPurpose(d.purpose);setTitle(d.title);setSource(d.source);setNoteId('');setFeedback('');})}>{j.title} · {label[j.status]}</button>)}</div>
 {job&&<><h3>{job.title} · {label[job.status]}</h3><p>用途：{job.purpose} · 已处理 {job.coverage.length}/{job.blocks.length} 块</p>
 <details><summary>覆盖、参考资料与缺口</summary>{job.coverage.map(c=><article key={c.blockId}><b>{c.blockId} · 字符 {c.offset}–{c.offset+c.length}</b><p>{c.overview}</p><p>参考：{(c.references||[]).join('；')}</p><p>缺口：{(c.gaps||[]).join('；')||'模型未报告；不代表无遗漏'}</p></article>)}</details>
 {job.candidates.map(c=><article key={c.id}><label><input type="checkbox" disabled={busy||c.status!=='candidate'||job.status==='enabled'} checked={selected.includes(c.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,c.id]:v.filter(x=>x!==c.id))}/>{c.name} · {label[c.status]}</label><p>{c.problem}</p><p>输入：{c.input} → 输出：{c.output}</p><p>{c.reason}</p>{c.evidence.map((ev,i)=><blockquote key={i}>[{ev.blockId}] {ev.quote}</blockquote>)}</article>)}
 {job.status!=='enabled'&&<button disabled={busy||!selected.length} onClick={()=>void run(async()=>setJob(await api(`/api/distill/jobs/${job.id}/draft`,{selected})))}>按所选候选生成草稿（重新生成会清除试跑）</button>}
 {job.capabilities&&<details open><summary>技能草稿</summary>{job.capabilities.map(c=><article key={c.candidateId}><h4>{job.candidates.find(n=>n.id===c.candidateId)?.name}</h4><p>适用：{c.trigger}</p><ol>{c.steps.map((s,i)=><li key={i}>{s}</li>)}</ol><p>完成标准：{c.completion}</p><p>边界：{c.boundaries.join('；')}</p><p>{c.example}</p></article>)}</details>}
 {['draft','tested'].includes(job.status)&&<form onSubmit={e=>{e.preventDefault();void run(async()=>setJob(await api(`/api/distill/jobs/${job.id}/trial`,{input,expected,boundaryInput})));}}><label>真实任务与必要输入<textarea required value={input} onChange={e=>setInput(e.target.value)}/></label><label>你期望的验收标准<textarea required value={expected} onChange={e=>setExpected(e.target.value)}/></label><label>不适用场景（边界测试）<textarea required value={boundaryInput} onChange={e=>setBoundaryInput(e.target.value)}/></label><button disabled={busy}>试跑草稿</button></form>}
 {job.trials?.map(t=><article key={t.id}><h4>试跑结果</h4><p>输入：{t.input}</p><p>标准：{t.expected}</p><pre>{t.result.result}</pre><p>验收：{t.result.checks.join('；')}</p><p>边界输入：{t.boundaryInput}</p><p>{t.result.boundaryResult}</p><p>未验证：{(t.result.limitations||[]).join('；')}</p></article>)}
 {job.status==='tested'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>setJob(await api(`/api/distill/jobs/${job.id}/enable`,{confirmed:true,feedback})));}}><label>人工验收反馈<textarea required value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="检查真实任务结果与边界测试，说明通过依据或已接受的局限"/></label><button disabled={busy}>确认试跑达标，启用技能</button></form>}
 {job.status==='enabled'&&<p>已启用：{job.saved}。蒸馏本身仅算积累，实际应用后请单独登记实践与成果。</p>}
 </>}
 </>}
 </section></div>, document.body);
}
