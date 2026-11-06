import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectTrace,readWorkBuddyActivity} from '../server/workbuddyActivity.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lifeos-workbuddy-'));
test.after(()=>fs.rm(dir,{recursive:true,force:true}));
const now=Date.now();
const start={type:'trace_start',trace:{traceId:'abc',workerPid:123,startedAt:new Date(now-1000).toISOString(),status:'running'}};
async function trace(name,rows){const file=path.join(dir,name);await fs.writeFile(file,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');return file;}
test('unfinished live WorkBuddy trace marks working, dead worker does not',async()=>{
 const file=await trace('a.jsonl',[start]);assert.equal((await inspectTrace(file,{now,isAlive:()=>true})).source,'WorkBuddy');assert.equal(await inspectTrace(file,{now,isAlive:()=>false}),null);
});
test('ended WorkBuddy trace does not remain running',async()=>{
 const file=await trace('b.jsonl',[start,{type:'trace_end',trace:{traceId:'abc',endedAt:new Date(now-100).toISOString()}}]);assert.equal((await inspectTrace(file,{now,isAlive:()=>true})).state,'done');assert.equal(await inspectTrace(file,{now:now+31000,isAlive:()=>true}),null);
});
test('stale unfinished trace and missing installation stay idle',async()=>{
 const file=await trace('c.jsonl',[start]);await fs.utimes(file,new Date(now-700000),new Date(now-700000));assert.equal(await inspectTrace(file,{now,isAlive:()=>true}),null);assert.equal(await readWorkBuddyActivity({traceRoots:[path.join(dir,'missing')],now}),null);
});
test('finished traces do not hide another active worker',async()=>{
 const root=path.join(dir,'traces');const child=path.join(root,'123');await fs.mkdir(child,{recursive:true});
 await fs.writeFile(path.join(child,'trace_abc.jsonl'),JSON.stringify(start)+'\n');
 assert.equal((await readWorkBuddyActivity({traceRoots:[root],now,isAlive:()=>true})).state,'working');
});
