process.env.NODE_ENV = "test";
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findTool, executeFileOpsTool } from '../server/tools.mjs';
import { taskContext } from '../server/taskContext.mjs';
import { matchSkill } from '../server/persona.mjs';
test('trigger metadata activates a skill',()=>{
 const skill={name:'复盘',aliases:[],triggers:['回顾本周']};
 assert.equal(matchSkill('请回顾本周', [skill]),skill);
});
test('file plans require exact confirmation, matching session, and execute once',async()=>{
 const dir=await fs.mkdtemp(path.join(process.cwd(),'.test-ops-'));
 try {
  const from=path.join(dir,'a.txt'),to=path.join(dir,'b.txt');await fs.writeFile(from,'original');
  const plan=await taskContext.run({sessionId:'a'},()=>findTool('plan_file_ops').run({operations:[{from,to}]}));
  await assert.rejects(taskContext.run({sessionId:'a'},()=>executeFileOpsTool({planId:plan.planId})),/确认/);
  await assert.rejects(taskContext.run({sessionId:'b',confirmedPlan:plan.planId},()=>executeFileOpsTool({planId:plan.planId})),/确认/);
  const result=await taskContext.run({sessionId:'a',confirmedPlan:plan.planId},()=>executeFileOpsTool({planId:plan.planId}));
  assert.equal(result.executed,1);assert.equal(await fs.readFile(to,'utf8'),'original');
  await assert.rejects(executeFileOpsTool({planId:plan.planId}),/找不到/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('changed source is rejected',async()=>{
 const dir=await fs.mkdtemp(path.join(process.cwd(),'.test-ops-'));
 try{const from=path.join(dir,'a'),to=path.join(dir,'b');await fs.writeFile(from,'a');
 const plan=await taskContext.run({sessionId:'a'},()=>findTool('plan_file_ops').run({operations:[{from,to}]}));
 await fs.writeFile(from,'changed');
 const result=await taskContext.run({sessionId:'a',confirmedPlan:plan.planId},()=>executeFileOpsTool({planId:plan.planId}));assert.equal(result.executed,0);assert.match(result.results[0].error,/变化/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
