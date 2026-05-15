# 剪映草稿导出 (一键生成草稿 zip 给用户下载)

> 用户在合成完成品视频后, 视频卡片下面会出现 "📦 导出剪映草稿 (按句分段)" 按钮.
> 点击后后端拉所有素材 + 跑 pyJianYingDraft 拼 3 轨道 (视频/音频/字幕) → 打 zip → 上传 OSS → 返签名下载链接.
> 用户解压到剪映草稿目录, 打开剪映就能看到一条按句分段的时间线, 直接微调.

## 1. 装 SDK

在 `D:\monoi-server` 跑:

```bat
pip install pyJianYingDraft
```

依赖很小 (~1 MB), 装完不影响其他模块.

> ℹ 推荐 Python 3.8 / 3.10 / 3.11 (跟项目原本就一致)

## 2. 拉新版代码

```bat
cd /d D:\monoi-server
curl -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/jianying_draft.py
curl -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/voice-server.py
```

## 3. 重启 voice-server.py

```bat
:: 关掉旧的 voice-server 进程
:: 重新启动 voice-server.py
```

不需要新 env, 不需要打印特殊日志 — 没装 pyJianYingDraft 的话, 用户点按钮时会前端报错 "pyJianYingDraft 未安装. 在 D:\monoi-server 跑: pip install pyJianYingDraft", 不影响其他功能.

## 4. 验证

1. 用 monoi 网页走完一遍: 写文案 → 配音 → 口播剪辑 → 匹配素材 → 一键合成
2. 合成完成的成品视频卡片下面应该有 **📦 导出剪映草稿 (按句分段)** 按钮
3. 点击, 等 30-60 秒 (拉素材+组装+上传, 取决于素材数量和大小)
4. 拿到下载链接 → 下载 zip → 解压
5. 把解压出来的文件夹整个拖到剪映草稿目录:
   - **Win**: `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\`
   - **Mac**: `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/`
6. 打开剪映, 进入主页应该能看到名为 `monoi_<时间戳>` 的草稿
7. 点开看时间线: 应该是按句分段的, 每句一段视频 + 字幕, 音频是整条 narration

## 5. 排错

### 用户点了按钮报 "pyJianYingDraft 未安装"
没装 SDK, 回到 step 1.

### 草稿在剪映里"素材丢失" (灰底)
草稿引用的是相对路径 `materials/xxx.mp4`. 用户解压时:
- 可能解压软件把文件夹名带 `__MACOSX` 或多套了一层目录 → 让用户检查解压后的目录结构, 直接的应该是:
  ```
  monoi_<时间戳>/
  ├── draft_content.json
  └── materials/
      ├── narration.m4a
      ├── narration.mp4
      ├── shot_000.mp4
      ├── shot_001.mp4
      └── ...
  ```
- 如果剪映还是找不到, 让用户在剪映里点"重新链接", 指向解压目录的 `materials/` 文件夹

### 提示 "口播视频文件已过期"
原因: 合成视频后的 narration_oss_key 在 OSS 留 1 天就被生命周期清掉了.
解法: 让用户重新走一遍口播剪辑 → 合成 → 导出.

### 草稿打开剪映报"格式不兼容" / 时间轴空白
说明用户的剪映版本格式跟 pyJianYingDraft 测试版本对不上 (库主要在剪映 5.9 测试).
临时方案: 让用户装一个剪映 5.9 (官方 changelog 可下载老版本).
长期方案: 等 pyJianYingDraft 跟新版本, 或者我们自己 patch.

## 6. 依赖关系 (确认环境)

需要 (跟现有 voice-server.py 共用):
- ffmpeg + ffprobe (在 PATH 里, 拼草稿前要从 narration.mp4 抽音轨)
- oss_helper.py (现有的 OSS 上下行 wrapper)
- pyJianYingDraft (新装)

不需要:
- 剪映本体 (后端只生成 JSON, 不打开剪映)
- 任何额外的字节服务/账号

## 7. License 备注

> ⚠️ pyJianYingDraft 仓库目前没有 LICENSE 文件 (= All Rights Reserved).
> monoi 是商业产品, 严格意义上需要明确授权才能商用.
> 建议步骤: 在 https://github.com/GuanYixuan/pyJianYingDraft/issues
> 开 issue 请作者补一个 MIT/Apache 2.0 license.
> 大概率 5 分钟会同意, 之后这页备注就可以删了.
> 如果作者不同意, 我们可以照他的源码格式说明 clean-room 重写一版 (估计 300-500 行).
