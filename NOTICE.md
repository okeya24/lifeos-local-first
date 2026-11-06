# 授权说明 / Licensing notice

本仓库采用**分区授权**：不同部分的许可不同，请按目录区分。

This repository is **split-licensed**. The license depends on which directory you use.

## 一、根目录代码与文档 — MIT

`server/`、`scripts/`、`tests/`、`data/`、`docs/`、`README.md`、`NOTICE.md` 以及本仓库根目录的声明文件，由本仓库维护者创作，按 [MIT](LICENSE) 授权。

Copyright (c) 2026 okeya24

## 二、`frontend/` 界面 — PolyForm Noncommercial 1.0.0

`frontend/` 目录基于第三方开源项目 **neural-creator-dashboard**（作者 luoluo-121，
<https://github.com/luoluo-121/neural-creator-dashboard>）修改而来，随本仓库一并分发。
其授权为 **PolyForm Noncommercial 1.0.0**（source-available，非开源许可）：

- 允许：个人学习、个人非商业使用、修改、非商业再分发
- 不允许：商业使用（需向原作者单独取得授权）
- 完整条款：`frontend/LICENSE`
- 原项目授权说明与历史例外（0.1.0 曾以 MIT 发布）：`frontend/NOTICE.md`、`frontend/licenses/`

本仓库维护者**无权**就 `frontend/` 授予任何商业许可，也不改变原作者已授出的权利。
本仓库对 `frontend/` 的修改同样受上述条款约束。

因此：**如果你要商业使用本项目的界面部分，必须自行联系原项目作者取得授权。**
后端部分（MIT）不受此限制。

## 三、示例数据

`vault/` 下的全部笔记、`data/seed.json` 中的全部指标与文案**均为虚构的演示数据**，
不来自任何真实个人，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh) 授权，
可自由复制、修改、商用，只需署名。

## 四、第三方依赖

依赖各自遵循其原始许可证，本仓库不对其重新授权。主要依赖：

| 依赖 | 许可 | 用途 |
|---|---|---|
| express | MIT | 本地 API 服务 |
| gray-matter | MIT | Markdown front-matter 解析 |
| react / react-dom | MIT | 前端框架 |
| vite | MIT | 前端构建 |

安装依赖后可用 `npx license-checker --summary` 查看完整清单。

## 五、未包含的内容

本仓库**不包含**任何真实个人笔记、课程讲义、第三方付费资料或抓取内容。
如果你在自己的部署中导入他人作品，请自行确认授权，本仓库的许可不覆盖这些内容。

---

If you are unsure which license applies to a file, assume the stricter one
(PolyForm Noncommercial for anything under `frontend/`).
