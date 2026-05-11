# 自动发布执行器 装环境步骤 (Windows)

> 给 voice-server 加上"一键发布到小红书/抖音"能力. 走 Playwright + 系统 Edge persistent profile, 不需要装 Chrome, 不需要翻墙.

## 一次性准备 (5 分钟)

### 1. 装 Playwright (Python 依赖)

打开 cmd / PowerShell, 进入 voice-server 项目目录:

```bat
cd D:\monoi-server
pip install playwright
```

### 2. 让 Playwright 认识系统 Edge

```bat
python -m playwright install msedge
```

这步**不会下载浏览器** (Edge 你 Windows 自带), 只是验证 Edge 路径 + 装 driver. 跑完应该看到 `msedge: chrome` 之类的提示.

### 3. 测试 Edge 能被脚本启起来

```bat
cd D:\monoi-server
python test_publisher.py
```

预期: 弹出一个 Edge 窗口, 自动打开 `https://creator.xiaohongshu.com/publish/publish?source=official`.

**这时候你要做的**:

1. 在弹出的 Edge 窗口里, 用你日常的方式**登录小红书** (账号密码 / 手机号 / 扫码 都行)
2. 登录完, 你应该会进入小红书创作者中心的"发布笔记"页面
3. 直接**关掉这个 Edge 窗口** (右上角 X)
4. 终端里应该打印 `窗口已关. 现在跑 ...`

cookie / session 会持久化在 `D:\monoi-server\edge-profile\` 目录里, 别手动删.

### 4. 验证登录态保留住了

```bat
python test_publisher.py check xhs
```

预期输出:
```
[publisher] 探测 xhs 登录态 (headless)...
[publisher] 结果: {'logged_in': True, 'platform': 'xhs', ...}
```

如果是 `logged_in: True` → 成功, profile 持久化生效. 抖音同理跑 `python test_publisher.py login douyin` 再 `check douyin`.

如果是 `logged_in: False` 但你确实登录了 → 探针可能过时, 告诉我 `detail` 里的内容我去更新 selector.

## 之后跑生产

stage 1 (本阶段) 只做到这一步: 验证 Edge profile 持久化能工作.

后续 stage 2 把 `voice-server.py` 加 `/api/publish/xhs` 和 `/api/publish/douyin` endpoint, 前端"发布"按钮调它们 → social_publisher 用同一个 profile 自动上传发布.

## 常见问题

**Q: `playwright install msedge` 报 "Edge not found"?**
A: Edge 不在标准路径. 找一下 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 是否存在. 一般 Win10/11 默认就有.

**Q: 弹出的 Edge 不是我平时用的那个?**
A: 这是设计上的隔离. `edge-profile` 目录跟你日常 Edge profile 是分开的, 不会污染你的收藏/历史. 但 Edge 程序本身是同一个.

**Q: 我能把 profile 目录改到其他地方吗?**
A: 设环境变量 `MONOI_EDGE_PROFILE=D:\其他路径` 再启动. 默认 `D:\monoi-server\edge-profile`.

**Q: 多个账号怎么办?**
A: V1 只支持单账号 (一个 profile). V2 再考虑多账号 (多个 profile 目录切换). 你单人创作的话 V1 够用.

**Q: cookie 失效了怎么办?**
A: 重跑 `python test_publisher.py login xhs` 再登一次就行. cookie 一般几周失效一次.
