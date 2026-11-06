import {promises as fs} from 'node:fs';
import crypto from 'node:crypto';
import {activityFile} from '../server/externalActivity.mjs';
const [, ,command='status',...rest]=process.argv;
if(command==='start'||command==='renew'){
 const prior=await fs.readFile(activityFile,'utf8').then(JSON.parse).catch(()=>null);
 const now=Date.now();const data={id:prior?.state==='working'?prior.id:crypto.randomUUID(),state:'working',source:'Codex',label:rest.join(' ')||'Codex 正在修改 LifeOS',since:prior?.state==='working'?prior.since:now,updatedAt:now,expiresAt:now+180000};
 const tmp=activityFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(data));await fs.rename(tmp,activityFile);console.log('Codex 工作状态已更新（180 秒租约）');
}else if(command==='done'){
 await fs.writeFile(activityFile,JSON.stringify({state:'done',label:'Codex 本次任务已完成',since:Date.now(),expiresAt:Date.now()+30000,updatedAt:Date.now()}));console.log('Codex 工作状态已结束');
}else console.log(await fs.readFile(activityFile,'utf8').catch(()=>'无开发状态'));
