# 本地运行与发布

## 当前方式

LifeOS 使用“本地静态页面 + 本地 API”的方式运行，不依赖云服务器：

```text
浏览器
  ↓
http://127.0.0.1:8787
  ↓
LifeOS Node 服务
  ├── dist/       构建后的界面
  ├── vault/      Markdown 资料
  └── Ollama      本地对话模型
```

## 日常入口

- 双击桌面 `LifeOS.webloc` 打开应用。
- 服务由 `com.lifeos.local` 登录任务自动启动。
- 如果页面打不开，双击 `启动 LifeOS.command`。

## 服务状态

```bash
./scripts/service-status.command
```

## 重启服务

```bash
./scripts/restart-service.command
```

## 查看日志

```text
~/Library/Logs/LifeOS/lifeos.log
~/Library/Logs/LifeOS/lifeos.error.log
```

## 更新版本

修改代码后执行：

```bash
pnpm typecheck
pnpm build
./scripts/restart-service.command
```

构建结果写入 `dist/`，Node 服务会直接托管它。

## 为什么不放公网

当前没有账号系统、HTTPS、权限隔离和公网防火墙。生活和健康资料都属于敏感数据，因此当前只监听本机地址。

以后要做远程访问时，至少需要：

1. 登录与设备授权
2. HTTPS
3. 资料发送预览
4. 云端存储加密
5. 备份和恢复
6. 审计日志与速率限制
