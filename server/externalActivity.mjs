import {promises as fs} from 'node:fs';
import path from 'node:path';
import {getWorkBuddyActivity} from './workbuddyActivity.mjs';
import {vaultDir} from './vaultNotes.mjs';
export const activityFile=path.join(vaultDir,'.external-activity.json');
export function mergeExternalActivity(internal, external, now=Date.now()){
 if(!external||external.state==='idle'||!Number.isFinite(external.expiresAt)||external.expiresAt<=now)return internal;
 // 应用内真实任务优先；开发租约不会覆盖正在运行的蒸馏。
 if(internal.state!=='idle'&&internal.state!=='done')return {...internal,external:{label:external.label,source:external.source||'Codex'}};
 return {...internal,state:external.state==='done'?'done':'tool',mode:'development',tool:(external.source||'Codex').toLowerCase(),label:external.label,color:'red',since:external.since,source:external.source||'Codex',expiresAt:external.expiresAt};
}
export async function readExternalActivity(internal){
 const now=Date.now();
 const [external,buddy]=await Promise.all([fs.readFile(activityFile,'utf8').then(JSON.parse).catch(()=>null),getWorkBuddyActivity()]);
 const valid=e=>e&&e.state!=='idle'&&Number.isFinite(e.expiresAt)&&e.expiresAt>now;
 const sources=[external,buddy].filter(valid);const running=sources.filter(s=>s.state!=='done');
 const chosen=running.length>1?{state:'working',source:running.map(s=>s.source||'Codex').join(' + '),label:running.map(s=>s.label).join('；'),since:Math.min(...running.map(s=>s.since)),expiresAt:Math.min(...running.map(s=>s.expiresAt))}:running[0]||sources[0];
 return mergeExternalActivity(internal,chosen,now);
}
