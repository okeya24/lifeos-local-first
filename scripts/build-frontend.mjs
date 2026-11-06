#!/usr/bin/env node
// 构建界面并部署到 dist/，让 server/index.mjs 直接托管。
import {execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const target = path.join(root, 'dist');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!(await fs.stat(path.join(frontend, 'node_modules')).catch(() => null))) {
  console.log('▸ 安装界面依赖（首次需要几分钟）');
  execFileSync(npm, ['install'], {cwd: frontend, stdio: 'inherit'});
}

console.log('▸ 构建界面');
execFileSync(npm, ['run', 'build'], {cwd: frontend, stdio: 'inherit'});

const source = path.join(frontend, 'dist');
const html = await fs.readFile(path.join(source, 'index.html'), 'utf8');
if (!html.includes('LifeOS')) throw new Error('界面构建入口不匹配，停止部署');

await fs.rm(target, {recursive: true, force: true});
await fs.cp(source, target, {recursive: true});
console.log(`▸ 已部署到 ${path.relative(root, target)}/`);
console.log('  启动：npm start  →  http://127.0.0.1:8787');
