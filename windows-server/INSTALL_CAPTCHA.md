# 阿里云人机验证 (Captcha 2.0) 集成

> 防机器人脚本批量发短信刷接口. 当前 send-sms 接口已经有 ① 同手机号 60 秒冷却 ② 同 IP 1 小时 5 次上限 两道防御 — env 配齐这一道滑块就再加一层 (用户多滑 1 次).
> 跟 SMS 一样 env-driven: env 没填齐自动跳过, 填齐自动开启, **不动代码**.

## 1. 阿里云控制台开通服务

1. 登 [阿里云控制台](https://yundun.console.aliyun.com/?p=captcha) → **应用安全 → 人机验证 (Captcha 2.0)**
2. 第一次进会让你 "立即开通", 选**按量付费** (有免费额度: 每月前 1 万次免费, 国内 ¥0.001/次, 100 万次 = ¥1000)
3. 进 **场景管理** → **新增场景**:
   - 场景名: `monoi-sms` (随便)
   - 验证模式: **智能验证** (滑块, 用户体验最好)
   - 关联应用: 创建一个 `monoi-web` 应用
4. 创建完拿到两个值:
   - **场景 ID** (SceneId, 形如 `xxxxxxxxxxxxxxxxxxxxxxxxxx`)
   - **prefix** (在 应用管理 → 应用详情, 也叫 `appkey 前缀`)

## 2. 创建专用 RAM 用户 (跟 SMS 那个分开, 最小权限)

> 不复用 SMS 的 AccessKey: 万一一个泄漏, 另一个还安全; 而且权限分开方便审计.

1. 阿里云控制台 → RAM → 用户 → 创建 `monoi-captcha`
2. 勾"使用永久 AccessKey 访问" → 拿 AccessKey ID + Secret
3. 加权限: **AliyunCaptchaFullAccess** (只这一个)

## 3. 后端配 env (windows-server/.env)

3 个变量都要填:

```env
# 后端校验用 (RAM 用户 monoi-captcha 的 AccessKey)
ALIYUN_CAPTCHA_ACCESS_KEY_ID=LTAI4G...
ALIYUN_CAPTCHA_ACCESS_KEY_SECRET=你的Secret
ALIYUN_CAPTCHA_SCENE_ID=场景ID
```

## 4. 后端装 SDK + 拉新版代码

```bat
cd /d D:\monoi-server
pip install alibabacloud_captcha20230305 alibabacloud_tea_openapi
curl -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/captcha_aliyun.py
curl -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py
```

依赖跟 SMS 共用 `tea_openapi`, 已经装过的话只需要再装 `captcha20230305`. 重启 main.py 后启动应该看到:

```
[captcha] mode = REAL (阿里云人机验证)
```

如果看到 `[captcha] mode = OFF (env 没配, send-sms 不强制滑块)` 就是 env 没读到, 检查 .env 是不是 3 个变量都填了.

## 5. 前端配 Vercel env

去 [Vercel Dashboard](https://vercel.com) → monoi 项目 → Settings → Environment Variables:

```
VITE_ALIYUN_CAPTCHA_SCENE_ID=场景ID         (跟后端 ALIYUN_CAPTCHA_SCENE_ID 同一个)
VITE_ALIYUN_CAPTCHA_PREFIX=prefix值
```

**注意: `VITE_*` 是公开变量 (会被打包进前端 JS, 任何人都能看到)**, SceneId 和 prefix 设计上就是公开的, 不是密钥. 真正的密钥 `ALIYUN_CAPTCHA_ACCESS_KEY_SECRET` 只在 Windows 后端 .env, 不要塞 Vercel.

填完触发一次重新部署 (Vercel 会自动). 部署完登录页/注册页点 "发送验证码" 应该弹滑块.

## 6. 验证

1. 真机 (手机或电脑浏览器) 打开 https://monoi.cn/login
2. 输入手机号, 点 "发送验证码"
3. 弹出阿里云滑块, 滑动完成
4. 收到短信 = 正常
5. 后端 console 应该看到 `[sms-real] 已发送给 1xxx (用途: login)` (没 captcha 校验失败的报错)

## 7. 关闭 (临时跳过滑块测试)

把 `ALIYUN_CAPTCHA_SCENE_ID` env 删掉或注释掉, 重启 main.py. 启动看到:
```
[captcha] mode = OFF (env 没配, send-sms 不强制滑块)
```
就 OK. 此时仍有 IP + 手机号双重限流, 不是裸奔.

## 8. 限流参数调整

`main.py` 里这两个常量:
- `SMS_RESEND_COOLDOWN = 60`        — 同手机号冷却秒数
- `SMS_IP_LIMIT_PER_HOUR = 5`       — 同 IP 每小时上限 (可用 env `SMS_IP_LIMIT_PER_HOUR=10` 覆盖)

调严: 把 5 改 3; 调松 (营销活动期): 改 10 或 20.

## 9. 为什么不只用滑块, 还要后端 IP 限流?

- 滑块 SDK 是公开 JS 文件, 攻击方可以反向破滑块图形 (虽然成本高)
- 滑块通过后, 仍然存在 "买已通过的 token 重放" 这种灰产
- IP 限流是底防, 滑块是前防, 二者叠加才稳

## 10. 成本估算

- Captcha 每月免费 1 万次, 之后 ¥0.001/次
- 1000 用户全周期 (注册 1 + 登录 5 + 找回 1 = 7 次滑块) ≈ 7000 次, 完全在免费额度内
- 即使 100 万 用户全部走流程 = 700 万次 = ¥7000

跟短信 ¥0.045/条比, 滑块成本几乎可忽略.
