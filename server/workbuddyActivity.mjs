import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const roots=[path.join(os.homedir(),'.workbuddy','traces'),path.join(os.homedir(),'.workbuddy-ai','traces')];
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}}
// Read only bounded head/tail blocks; no prompt, span input or output leaves this adapter.
export async function inspectTrace(file,{now=Date.now(),isAlive=alive}={}){
 const handle=await fs.open(file,'r');try{
  const stat=await handle.stat();if(stat.mtimeMs<now-86400000)return null;
  const head=Buffer.alloc(Math.min(stat.size,32768));await handle.read(head,0,head.length,0);
  const first=head.toString('utf8').split('\n')[0];let row;try{row=JSON.parse(first);}catch{return null;}
  if(row.type!=='trace_start'||!row.trace)return null;
  const trace=row.trace;const since=Date.parse(trace.startedAt);if(!Number.isFinite(since)||since>now+60000)return null;
  const tail=Buffer.alloc(Math.min(stat.size,65536));const offset=stat.size-tail.length;await handle.read(tail,0,tail.length,offset);
  const lines=tail.toString('utf8').split('\n');if(offset)lines.shift();
  for(const line of lines.reverse()){
   if(!line.includes('"trace_end"'))continue;
   try{const end=JSON.parse(line);if(end.type==='trace_end'&&end.trace?.traceId===trace.traceId){const endedAt=Date.parse(end.trace.endedAt);return Number.isFinite(endedAt)&&now-endedAt<30000&&endedAt<=now?{state:'done',source:'WorkBuddy',label:'WorkBuddy 刚完成任务',since,expiresAt:endedAt+30000}:null;}}catch{}
  }
  // An unfinished trace from a dead worker or with no updates for 10 minutes is not reliable evidence.
  if(stat.mtimeMs<now-600000||!isAlive(trace.workerPid))return null;
  return {state:'working',source:'WorkBuddy',label:'WorkBuddy 正在运行任务',since,expiresAt:stat.mtimeMs+600000};
 }finally{await handle.close();}
}
export async function readWorkBuddyActivity({traceRoots=roots,now=Date.now(),isAlive=alive}={}){
 const candidates=[];
 for(const root of traceRoots){
  const entries=await fs.readdir(root,{withFileTypes:true}).catch(()=>[]);const dirs=[];
  for(const e of entries){if(!e.isDirectory()||!/^\d+$/.test(e.name))continue;const dir=path.join(root,e.name);const stat=await fs.stat(dir).catch(()=>null);if(stat)dirs.push({dir,time:stat.mtimeMs});}
  for(const {dir} of dirs.sort((a,b)=>b.time-a.time).slice(0,8)){
   for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
    if(!e.isFile()||!/^trace_[a-f0-9]+\.jsonl$/.test(e.name))continue;const file=path.join(dir,e.name);const stat=await fs.stat(file).catch(()=>null);if(stat&&stat.mtimeMs>=now-86400000)candidates.push({file,time:stat.mtimeMs});
   }
  }
 }
 let done=null;
 for(const {file} of candidates.sort((a,b)=>b.time-a.time).slice(0,24)){
  const activity=await inspectTrace(file,{now,isAlive}).catch(()=>null);
  if(activity?.state==='working')return activity;if(activity?.state==='done'&&!done)done=activity;
 }
 return done;
}
let cacheAt=0,cache=null;
export async function getWorkBuddyActivity(){const now=Date.now();if(now-cacheAt<1000)return cache;cache=await readWorkBuddyActivity();cacheAt=now;return cache;}
