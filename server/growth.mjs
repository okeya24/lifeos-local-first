const fmt = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export function growthReport(notes, events, now = Date.now()) {
  const days = Array.from({length:14},(_,i)=>({date:fmt.format(new Date(now-(13-i)*86400000)), accumulation:0,imported:0,practice:0,outcome:0,count:0}));
  const slots = new Map(days.map(d=>[d.date,d]));
  let unknownDate=0;
  for(const n of notes){if(!n.createdDate){unknownDate++;continue;}const d=slots.get(n.createdDate);if(d)d[n.origin==='import'?'imported':'accumulation']++;}
  const evidence=[];
  for(const e of events){const d=slots.get(e.date);if(d && ['practice','outcome'].includes(e.type)){d[e.type]++;evidence.push(e);}}
  for(const d of days)d.count=d.practice;
  const totals=Object.fromEntries(['accumulation','imported','practice','outcome'].map(key=>[key,days.reduce((n,d)=>n+d[key],0)]));
  const stages=new Map();for(const e of events.filter(e=>e.skillId&&e.level).sort((a,b)=>String(a.at).localeCompare(String(b.at))))stages.set(e.skillId,{skillId:e.skillId,level:e.level,noteId:e.noteId,date:e.date});
  return {days,totals,evidence,stages:[...stages.values()],unknownDate,total14:totals.practice,metric:'practice',label:'行动轨迹',standard:'仅统计明确登记并关联笔记的实践与成果；积累按明确创建日期，导入单列，不根据文件修改时间推测。',trend:'flat'};
}
