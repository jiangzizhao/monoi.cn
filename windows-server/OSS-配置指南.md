# 阿里云 OSS 直传配置指南

口播视频上传走 NATAPP 太慢, 改用阿里云 OSS 临时中转:
- 浏览器 → 直传 OSS (走 OSS 多 Mbps 带宽, 10x NATAPP)
- 服务器 → 从 OSS 拉源视频 → 处理 → 上传输出回 OSS
- 浏览器 → 从 OSS 直接播放/下载剪辑后视频

OSS 只做临时中转, 不做长期存储 (lifecycle 自动 1 天删干净). 月成本几乎为零.

---

## 一、阿里云控制台开 bucket (5 分钟)

### 1. 开 OSS bucket

1. 登录 [阿里云 OSS 控制台](https://oss.console.aliyun.com)
2. 左上角点 "Bucket 列表" → "创建 Bucket"
3. 配置:
   - Bucket 名称: `monoi-temp` (随便起, 全局唯一)
   - Region: `华东1 (杭州)` 或 `华东2 (上海)` (跟未来云服务器同 region)
   - 存储类型: `标准存储`
   - 同城冗余: 关 (省钱)
   - 版本控制: 关
   - **读写权限**: `私有` (重要, 不能 public-read)
4. 点 "确定"

### 2. 配置 CORS (允许浏览器跨域 PUT)

进入刚建的 bucket → 左侧菜单 "权限控制" → "跨域设置" → "创建规则":
- 来源: `https://monoi.cn` (生产域名), 再加一行 `*` 测试用
- 允许 Methods: `PUT`, `GET`, `POST`
- 允许 Headers: `*`
- 暴露 Headers: `ETag`
- 缓存时间: `300`

不配 CORS 浏览器 PUT 会报错.

### 3. 配置 Lifecycle (自动删过期文件)

bucket → 左侧菜单 "基础设置" → "生命周期" → "创建规则":
- 策略: `按前缀匹配`
- 前缀: `uploads/` → 1 天后删除
- 再加一条: 前缀 `sources/` → 1 天后删除
- 再加一条: 前缀 `outputs/` → 1 天后删除

文件用完后会被自动清理, 不会积成本.

---

## 二、拿 AccessKey

### 用 RAM 子账号 (强烈推荐, 不用主账号 key)

1. 进 [RAM 控制台](https://ram.console.aliyun.com)
2. "用户" → "创建用户":
   - 登录名: `monoi-oss`
   - 访问方式: 勾 "OpenAPI 调用访问"
3. 创建后会显示 `AccessKey ID` 和 `AccessKey Secret`, **立刻复制保存** (Secret 只显示这一次)
4. 给这个用户加权限:
   - 用户详情 → "权限管理" → "新增授权"
   - 选系统策略 `AliyunOSSFullAccess` (或自己写一个只能操作 `monoi-temp` bucket 的策略, 更安全)

---

## 三、家里 server 配 .env

在 `D:\monoi-server` 目录下 (跟 `main.py` 同级) 的 `.env` 文件加:

```ini
# OSS 配置 (口播视频/音频直传加速)
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_BUCKET=monoi-temp
OSS_REGION=cn-hangzhou
OSS_ACCESS_KEY_ID=LTAI5tXXXXXXXXXX
OSS_ACCESS_KEY_SECRET=XXXXXXXXXXXXXXXX
```

注意:
- `OSS_ENDPOINT` 跟你 bucket 的 region 对应:
  - 华东1 杭州: `https://oss-cn-hangzhou.aliyuncs.com`
  - 华东2 上海: `https://oss-cn-shanghai.aliyuncs.com`
  - 华北2 北京: `https://oss-cn-beijing.aliyuncs.com`
- 别填内网 endpoint (`-internal.aliyuncs.com`), 家里 server 不在阿里云内网, 走公网

---

## 四、装 oss2 库

家里 server 进 main.py 的 venv, 装:

```bash
pip install oss2
```

(如果用 cosyvoice 的 venv, 也照样装一份给 voice-server 用)

---

## 五、重启验证

1. 重启 main.py + voice-server.py (一键启动全部.bat)
2. 打开 monoi.cn → 文案 → 口播 → 口播剪辑 → 选个视频上传
3. 上传进度条应该飞快 (几十 MB/s, 不再是 NATAPP 的几百 KB/s)
4. 看后端日志确认 OSS 上传/下载正常

如果 OSS 没配 / 配错, 前端会自动退回老的 NATAPP 上传 (兼容回退), 不会 break 现有功能.

---

## 六、未来上云后

整套代码无缝迁移: 把 server 部署到阿里云 GPU 机器 (跟 OSS 同 region), 把 `OSS_ENDPOINT` 换成内网地址 (`-internal.aliyuncs.com`):
- 内网下行 0 流量费
- 内网带宽 ~Gbps, 比公网快 10x
- 全程 OSS 内网, 不走 NATAPP

不用改一行业务代码.

---

## 月成本估算

假设每月 50 个口播视频任务, 每个 100MB:
- 存储: 几小时内删, 折算 < 0.01元/月
- 上传: 浏览器 → OSS 免费
- 服务器下行: 50 × 100MB × 0.5元/GB = 2.5元
- 浏览器下行剪辑后视频: 50 × 100MB × 0.5元/GB = 2.5元
- **合计: ~5 元/月**

升级 NATAPP 高带宽套餐随便几十元/月, OSS 直传又快又便宜.
