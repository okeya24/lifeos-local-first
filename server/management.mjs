import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { vaultDir } from './vaultNotes.mjs';
import { listSkills } from './persona.mjs';
const revision = text => crypto.createHash('sha256').update(text).digest('hex');
export function installManagement(app) {
  async function target(id) {
    const file = path.resolve(vaultDir, String(id || ''));
    if (!file.startsWith(vaultDir + path.sep) || !file.endsWith('.md')) throw new Error('笔记路径无效');
    const real = await fs.realpath(file);
    if (!real.startsWith(vaultDir + path.sep)) throw new Error('不允许外部链接');
    return file;
  }
  app.get('/api/versions',async(_req,res,next)=>{try{
    const dir=path.join(vaultDir,'.versions');const names=await fs.readdir(dir).catch(()=>[]);
    const items=[];for(const name of names){try{items.push({version:name,...JSON.parse(await fs.readFile(path.join(dir,name),'utf8'))});}catch{}}
    res.json(items.sort((a,b)=>b.at.localeCompare(a.at)).map(({content,...item})=>item));
  }catch(e){next(e);}});
  app.post('/api/restore',async(req,res,next)=>{try{
    const name=String(req.body.version||'');if(!/^[a-f0-9-]+\.json$/.test(name))return res.status(400).json({error:'版本无效'});
    const item=JSON.parse(await fs.readFile(path.join(vaultDir,'.versions',name),'utf8'));
    // 恢复到新笔记，避免覆盖后续编辑或外部修改。
    const directory=path.join(vaultDir,'00 收件箱');await fs.mkdir(directory,{recursive:true});
    const file=path.join(directory,'恢复-'+crypto.randomUUID()+'.md');await fs.writeFile(file,item.content,{flag:'wx'});
    res.json({id:path.relative(vaultDir,file)});
  }catch(e){next(e);}});
  app.get('/api/skills', async (_req,res,next) => { try { res.json(await listSkills()); } catch(e){next(e);} });
  app.get('/api/record', async (req,res,next) => { try {
    const file = await target(req.query.id); const content = await fs.readFile(file,'utf8');
    res.json({content, revision:revision(content)});
  } catch(e){next(e);} });
  const locks = new Set();
  app.post('/api/record', async (req,res,next) => {
    let file;
    try {
      file = await target(req.body.id);
      if (locks.has(file)) return res.status(409).json({error:'笔记正在保存，请重试'});
      locks.add(file);
      const content = await fs.readFile(file,'utf8');
      if (revision(content) !== req.body.revision) return res.status(409).json({error:'文件已被修改，请重新打开后合并'});
      const backup = path.join(vaultDir,'.versions',crypto.randomUUID()+'.json');
      await fs.mkdir(path.dirname(backup),{recursive:true});
      await fs.writeFile(backup,JSON.stringify({id:req.body.id,content,at:new Date().toISOString()}),{flag:'wx'});
      if (req.body.archive) {
        const archive = path.join(vaultDir,'90 归档','记录管理',crypto.randomUUID()+'.md');
        await fs.mkdir(path.dirname(archive),{recursive:true}); await fs.rename(file,archive);
        res.json({id:path.relative(vaultDir,archive), archived:true});
      } else {
        if(typeof req.body.content !== 'string') return res.status(400).json({error:'正文必须是文本'});
        const tmp=file+'.'+crypto.randomUUID()+'.tmp';
        await fs.writeFile(tmp,req.body.content,{flag:'wx'}); await fs.rename(tmp,file);
        res.json({revision:revision(req.body.content)});
      }
    } catch(e){next(e);} finally {if(file) locks.delete(file);}
  });
  app.post('/api/memory',async(req,res,next)=>{try{
    const file=path.join(vaultDir,'agents','user-prefs.md');
    const content=await fs.readFile(file,'utf8').catch(()=>'');
    if(typeof req.body.content !== 'string') return res.status(400).json({error:'记忆必须是文本'});
    if(revision(content)!==req.body.revision) return res.status(409).json({error:'记忆已变化，请重新打开'});
    const backup=path.join(vaultDir,'.memory','backups',crypto.randomUUID()+'.md');
    await fs.mkdir(path.dirname(backup),{recursive:true});await fs.writeFile(backup,content,{flag:'wx'});
    const tmp=file+'.tmp-'+crypto.randomUUID();await fs.writeFile(tmp,req.body.content);await fs.rename(tmp,file);
    res.json({revision:revision(req.body.content)});
  }catch(e){next(e);}});
  app.get('/api/memory',async (_req,res,next)=>{try{
    const file=path.join(vaultDir,'agents','user-prefs.md');
    const content=await fs.readFile(file,'utf8').catch(()=>'');
    const raw=await fs.readFile(path.join(vaultDir,'.memory','candidates.jsonl'),'utf8').catch(()=>'');
    res.json({content,revision:revision(content),candidates:raw.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean)});
  }catch(e){next(e);}});
}
