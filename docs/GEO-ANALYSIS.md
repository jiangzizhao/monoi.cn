# monoi.cn GEO (AI 搜索优化) 分析报告

日期: 2026-06-12 · 范围: https://monoi.cn 首页 (React SPA, OSS 静态托管 + CDN)

> 背景共识 (Google 官方口径): 针对 AI 搜索的优化本质仍是 SEO 基本功——可抓取、有实质内容、结构清晰、品牌可信。llms.txt 目前**没有**被任何主流 AI 搜索证实作为引用排序信号 (Mueller/Illyes 均否认, 30 万域名研究无相关性), 本次照做只因成本≈0。

## GEO 就绪评分: 优化前 ~22/100 → 优化后 ~55/100

| 维度 (权重) | 优化前 | 优化后 | 说明 |
|---|---|---|---|
| 可引用性 25% | 5/25 | 17/25 | 静态可读文本 86 字符 → ~700 字符: 定义块 + 功能列表 + 定价事实 + 3 条自包含 FAQ |
| 结构可读性 20% | 4/20 | 16/20 | 无 H 结构 → H1→H2 层级 + 问题式标题 + 列表 |
| 多模态 15% | 3/15 | 3/15 | 未动 (爬虫视角无图片/视频; SPA 限制) |
| 权威/品牌信号 20% | 2/20 | 5/20 | **"monoi.cn" 全网零第三方提及 (实测搜索)** — 最大短板, 见下 |
| 技术可访问性 20% | 8/20 | 14/20 | robots/llms/sitemap 全 404 → 已补; 但 JS 内容对 AI 爬虫仍不可见 (AI 爬虫不执行 JS), 子路由 404 状态码未解 |

## 本次已落地 (2026-06-12)

1. **`robots.txt`**: 显式放行 GPTBot / OAI-SearchBot / ChatGPT-User / ClaudeBot / PerplexityBot / Bytespider(豆包); Disallow /admin /account; 指向 sitemap。
2. **`llms.txt`**: 中英双语产品定义 + 主要页面 + 核心功能 + 真实定价 + 联系方式。
3. **`sitemap.xml`**: 仅收录首页 (子路由返回 404 状态码, 收录是负信号, 见遗留问题 ①)。
4. **首页静态可读内容扩充** (#root 内, React 挂载即替换): "monoi 是什么"定义块 (前 60 字直接回答) + "能做什么"功能列表 + "多少钱"定价段 (与 Landing 真值一致: 免费700积分/Pro ¥99/Max ¥199) + 3 条自包含 FAQ。全部遵守"无技术名词"文案规范。
5. **Organization schema 补 contactPoint** (tina@monoi.cn)。
6. **部署 workflow**: robots/llms/sitemap 改 no-cache (原本会被打 1 年 immutable)。

## 遗留问题 (按影响排序)

### ① SPA 子路由返回 404 状态码 (高影响, 需要她拍板)
`/register` `/terms` `/privacy` 内容渲染正常但 HTTP 状态是 404 (OSS 静态站"错误页=index.html"机制) → 搜索引擎和 AI 爬虫一律视为死页, 永远不收录。修法是阿里云控制台配置 (非代码): CDN EdgeScript 把 html 404 改写 200, 或 OSS RoutingRules。**风险: 配置不当可能影响推广链接 (monoi.cn/register?ref=) 的现有回退行为, 动之前要在 CDN 上小心验证。**

### ② 品牌提及为零 (最高杠杆, 非代码工作)
Ahrefs 7.5 万品牌研究: 品牌提及与 AI 引用的相关性是反链的 ~3 倍。"monoi.cn" 目前全网搜不到任何第三方提及。中文语境对应动作 (优先级序):
- **知乎**: 回答"不出镜怎么做口播视频""AI 数字人工具推荐"类问题, 自然带 monoi (DeepSeek/Kimi 等国内 AI 大量引用知乎)
- **B站/抖音/小红书**: 用 monoi 做"用 AI 做了 30 天视频"类教程内容 (吃自己狗粮, 配合 monoi-wenan 文案)
- **AI 工具导航站收录**: ai-bot.cn 等导航站提交收录 (搜索"AI 视频工具"它们霸屏)
- 远期: 维基百科/百度百科词条 (需先有第三方报道)

### ③ AI 爬虫看不到 React 渲染的完整 Landing (中影响)
AI 爬虫不执行 JS——静态块已缓解核心信息, 但完整 FAQ/定价表仍不可见。彻底解法是预渲染 (vite-plugin-prerender / SSG), 改动较大, 等有自然流量诉求再做。

### ④ 多模态零分 (低优先)
静态 HTML 无图片; og:image 已有。预渲染做了之后自然解决。

## 平台特性速查
- **Google AI Overviews**: 92% 引用来自 top-10 排名页 → 先解决基础收录 (①)
- **ChatGPT**: 偏好维基百科 (47.9%) + Reddit → 中文场景对应知乎/百科
- **Perplexity**: 偏好 Reddit (46.7%) → 社区讨论提及
- **国内 (DeepSeek/Kimi/豆包)**: 知乎权重极高; Bytespider 已放行
