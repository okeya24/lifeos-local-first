# frontend — 神经网络工作台界面

这个目录是 LifeOS Local 的界面部分：光球、五只水母、双向链接和右侧分析栏。

## 来源与授权

基于开源项目 **neural-creator-dashboard** 修改而来：

- 作者：luoluo-121 及贡献者
- 上游：<https://github.com/luoluo-121/neural-creator-dashboard>
- 许可：**PolyForm Noncommercial 1.0.0**（source-available，非开源许可，不授予商业使用权）
- 完整条款：[`LICENSE`](LICENSE)、[`NOTICE.md`](NOTICE.md)、[`licenses/MIT-legacy.txt`](licenses/MIT-legacy.txt)

本目录的修改同样受该许可约束。**商业使用需向原作者单独取得授权。**
仓库根目录（后端）是 MIT，与这里分开授权，详见根目录 [`NOTICE.md`](../NOTICE.md)。

## 本地开发

```bash
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173，热更新
npm run build        # 产物在 frontend/dist
```

## 换成自己的笔记

界面默认读 `src/data/sample.js` 里的**虚构示例数据**。要换成真实笔记：

```bash
# 在仓库根目录
cd frontend
npm run import -- --vault ../vault          # 生成 src/data/my-data.js 并切换
npm run import -- --reset                   # 切回示例数据
```

`my-data.js` 已被 `.gitignore` 排除，不会误提交你的笔记。
`import` 只读取 Markdown，不会修改你的文件，也不联网。

## 目录

```text
src/neural/     主界面：Home、panels、Analysis、ProgressWorkbench、NetworkCanvas
src/data/       数据入口（sample.js 示例 / my-data.js 你的数据）
src/config.js   品牌名、中心节点文案、头像
public/media/   光球与水母的视频、图片素材
scripts/        笔记导入与自检脚本
```
