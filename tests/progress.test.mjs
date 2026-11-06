import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {growthReport} from '../server/growth.mjs';
import {mergeExternalActivity} from '../server/externalActivity.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'lifeos-workflow-'));
process.env.NODE_ENV='test';process.env.LIFEOS_TEST_VAULT=root;
const {startDistill,draftDistill,trialDistill,enableDistill,verifyCandidate}=await import('../server/distillWorkflow.mjs');
test.after(async()=>{await fs.rm(root,{recursive:true,force:true});});
test('growth separates imports, actual practice and outcomes; no mtime inference',()=>{
 const report=growthReport([{createdDate:'2026-11-06',origin:'import'},{createdDate:'2026-11-06',origin:'authored'},{modifiedAt:'2026-11-06'}],[{date:'2026-11-06',type:'practice',noteId:'a'},{date:'2026-11-06',type:'outcome',noteId:'b'}],Date.parse('2026-11-06T12:00:00Z'));
 assert.deepEqual(report.totals,{accumulation:1,imported:1,practice:1,outcome:1});assert.equal(report.unknownDate,1);assert.equal(report.days.at(-1).count,1);
});
test('external activity is red while lease lives, expires, and respects internal task',()=>{
 const idle={state:'idle'};const external={state:'working',expiresAt:200,label:'Codex 正在验证',since:0};
 assert.equal(mergeExternalActivity(idle,external,100).color,'red');assert.equal(mergeExternalActivity(idle,external,201),idle);
 assert.equal(mergeExternalActivity({state:'thinking',label:'蒸馏'},external,100).label,'蒸馏');
});
test('fabricated quote cannot become a verified candidate',()=>{
 const c=verifyCandidate({name:'方法',problem:'问题',input:'输入',output:'输出',evidence:[{blockId:'B1',quote:'这一段是模型编造的引用根本不在原文里面'}]},[{id:'B1',text:'真实原文'}]);assert.equal(c.status,'needs_review');assert.equal(c.evidence.length,0);
});
test('distillation covers tail, stays outside skills until trial and explicit acceptance',async()=>{
 const quote='这是原文中真实存在的具体操作方法与验收标准。';const source=quote.repeat(300);
 let calls=0;const generate=async({messages})=>{calls++;const id=messages[1].content.match(/块：(B\d+)/)[1];return {content:JSON.stringify({overview:'按来源提取',candidates:[{name:'方法'+id,problem:'解决遗漏',input:'任务',output:'清单',evidence:[{blockId:id,quote}]}],references:[],gaps:[]})};};
 await assert.rejects(startDistill({source,title:'测试',generate}),/用途/);
 const job=await startDistill({source,title:'测试',purpose:'测试独立完成',generate});assert.equal(job.coverage.length,job.blocks.length);assert.ok(job.blocks.length>1);assert.equal(calls,job.blocks.length);
 await assert.rejects(fs.access(path.join(root,'agents','skills')));
 await startDistill({source,title:'测试',purpose:'测试独立完成',generate});assert.equal(calls,job.blocks.length);
 const selected=[job.candidates[0].id];const draft=await draftDistill(job.id,selected,{generate:async()=>({content:JSON.stringify({capabilities:[{candidateId:selected[0],trigger:'有任务',steps:['读取输入并核对'],branches:['缺输入时先补充'],completion:'所有项目可核验',boundaries:['无输入不适用'],example:'合成演练：核对清单'}]})})});assert.equal(draft.status,'draft');
 await assert.rejects(enableDistill(job.id,{confirmed:true,feedback:'同意'}),/试跑/);
 await trialDistill(job.id,{input:'真实测试任务',expected:'输出清单',boundaryInput:'无输入',generate:async()=>({content:JSON.stringify({result:'核对清单',checks:['有输出'],boundaryResult:'缺输入，不执行',limitations:['未执行外部操作']})})});
 await assert.rejects(enableDistill(job.id,{confirmed:false,feedback:'同意'}),/验收/);
 const enabled=await enableDistill(job.id,{confirmed:true,feedback:'检查清单与边界，符合预期'});assert.equal(enabled.status,'enabled');assert.match(await fs.readFile(path.join(root,enabled.saved),'utf8'),/真实存在/);
});
test('failed extraction resumes after last completed block',async()=>{
 const quote='用于测试断点续跑的真实原文依据内容。';const source=quote.repeat(400);let calls=0;
 const generate=async({messages})=>{calls++;if(calls===2)throw Error('模拟超时');return {content:JSON.stringify({overview:'块内容',candidates:[],references:[],gaps:[]})};};
 await assert.rejects(startDistill({source,title:'续跑',purpose:'续跑测试',generate}),/超时/);
 let retryCalls=0;const job=await startDistill({source,title:'续跑',purpose:'续跑测试',generate:async()=>{retryCalls++;return {content:'{"overview":"续跑","candidates":[],"references":[],"gaps":[]}'};}});
 assert.equal(retryCalls,job.blocks.length-1);assert.equal(job.coverage.length,job.blocks.length);
});
