import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import {beginActivity,endActivity} from './agent.mjs';
import {vaultDir,walkUserNotes} from './vaultNotes.mjs';
import {startDistill,listJobs,readJob,draftDistill,trialDistill,enableDistill} from './distillWorkflow.mjs';
const eventFile=path.join(vaultDir,'.progress','events.jsonl');
export async function readProgress(){const raw=await fs.readFile(eventFile,'utf8').catch(()=> '');return raw.split('\n').filter(Boolean).map(s=>{try{return JSON.parse(s);}catch{return null;}}).filter(Boolean);}
async function note(id){const file=path.resolve(vaultDir,String(id||''));if(!file.startsWith(vaultDir+path.sep)||!file.endsWith('.md'))throw Error('笔记路径无效');const real=await fs.realpath(file);if(!real.startsWith(vaultDir+path.sep))throw Error('不支持外部链接');return matter(await fs.readFile(real,'utf8'));}
export function installProgressApi(app){
 const wrap=fn=>async(req,res)=>{const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const isWork=req.method==='POST';if(isWork)beginActivity(req.path.includes("distill")?"distill":"tools",req.path.includes("distill")?"蒸馏工作台处理中":"登记行动证据");try{const data=await fn(req,controller.signal);if(!res.destroyed)res.json(data);}catch(e){if(!res.destroyed)res.status(400).json({error:e.message});}finally{if(isWork)endActivity();}};
 app.post('/api/lifeos/actions',wrap(async(req)=>{
  const {type,title,noteId,date,skillId,level}=req.body;
  if(!['practice','outcome'].includes(type)||!String(title||'').trim()||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('请填写类型、标题、有效日期与证据笔记');
  await note(noteId);
  const key=crypto.createHash('sha256').update(JSON.stringify({type,title,noteId,date,skillId,level})).digest('hex');
  const existing=(await readProgress()).find(e=>e.key===key);if(existing)return existing;
  if(level && !String(skillId||'').trim())throw Error('登记能力阶段时请填写能力名称');
  if(level && !['learned','guided','independent','transfer'].includes(level))throw Error('能力阶段无效');
  const event={id:crypto.randomUUID(),key,type,title,noteId,date,skillId:skillId||null,level:level||null,confirmed:true,at:new Date().toISOString()};
  await fs.mkdir(path.dirname(eventFile),{recursive:true});await fs.appendFile(eventFile,JSON.stringify(event)+'\n');return event;
 }));
 app.get('/api/distill/materials',wrap(async()=>{
  const result=[];for(const file of await walkUserNotes()){const parsed=await note(path.relative(vaultDir,file));result.push({id:path.relative(vaultDir,file),title:parsed.data.title||path.basename(file,'.md')});}async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){if(e.name.startsWith('.'))continue;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else if(e.isFile()&&e.name.endsWith('.md')&&e.name!=='README.md'){const parsed=await note(path.relative(vaultDir,file));result.push({id:path.relative(vaultDir,file),title:parsed.data.title||path.basename(file,'.md')});}}}
  await walk(path.join(vaultDir,'待蒸馏'));return result;
 }));
 app.get('/api/distill/jobs',wrap(()=>listJobs()));
 app.get('/api/distill/jobs/:id',wrap(req=>readJob(req.params.id)));
 app.post('/api/distill/jobs',wrap(async(req,signal)=>{const body=req.body;let source=body.source;let title=body.title;if(body.noteId){const n=await note(body.noteId);source=n.content;title=n.data.title||path.basename(body.noteId,'.md');}return startDistill({source,title,purpose:body.purpose,signal});}));
 app.post('/api/distill/jobs/:id/draft',wrap((req,signal)=>draftDistill(req.params.id,Array.isArray(req.body.selected)?req.body.selected:[],{signal})));
 app.post('/api/distill/jobs/:id/trial',wrap((req,signal)=>trialDistill(req.params.id,{...req.body,signal})));
 app.post('/api/distill/jobs/:id/enable',wrap(req=>enableDistill(req.params.id,req.body)));
}
