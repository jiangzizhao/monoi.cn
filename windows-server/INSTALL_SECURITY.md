# 安全加固 (P0)

> 5 层防御加到 monoi 后端. 大部分 env-gated 不动 env 走默认宽松 (开发期方便), 配 env 收紧 (生产上线必做).

## 1. 改了什么

| 项 | 状态 | env (生产必配) | 默认行为 |
|---|---|---|---|
| **CORS 严格化** | 默认就启用 | `ALLOWED_ORIGINS=https://monoi.cn,https://www.monoi.cn` (可逗号分隔多个) | 默认只允许 monoi.cn / *.vercel.app / localhost |
| **JWT_SECRET_KEY** | 启动告警 | `JWT_SECRET_KEY=<32+位随机字符>` | 没配走老硬编码 (启动 ⚠️ 提示) |
| **登录失败锁定** | 默认就启用 | `LOGIN_LOCK_THRESHOLD=5` / `LOGIN_LOCK_WINDOW_SEC=900` / `LOGIN_LOCK_DURATION_SEC=900` | 默认 5 次失败/15 分钟锁 15 分钟 |
| **/api/pay/create 限流** | 默认就启用 | (无 env, 写死 10 次/分钟) | 同 IP 1 分钟最多 10 个订单 |
| **admin IP 白名单** | env-gated | `ADMIN_IP_WHITELIST=1.2.3.4,5.6.7.8` | 没配 = 不强制 (走 is_admin 字段判) |

## 2. 上线前必做 (生产环境)

### 2.1 生成新的 JWT_SECRET_KEY

之前硬编码 `monoi-secret-key-2025`, 写在 git 里相当于裸奔. 必须改:

cmd 跑一下生成 64 字符随机字符串:
```bat
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

输出类似 `aBcD...XyZ`, 拷下来.

`.env` 加:
```env
JWT_SECRET_KEY=刚生成的那串
```

⚠️ **改了 JWT_SECRET_KEY 之后所有现有用户 token 会失效**, 用户需要重新登录. 上线时找个流量低谷做, 用户重新登一次就好.

### 2.2 配 ALLOWED_ORIGINS

默认已经允许了 monoi.cn 跟 vercel, 一般不用动. 如果你有别的部署域名 (比如老 monoi.com), 显式列出:

```env
ALLOWED_ORIGINS=https://monoi.cn,https://www.monoi.cn,https://monoi.com
```

### 2.3 admin IP 白名单 (推荐)

防管理员 token 泄漏被滥用 + 防社工攻击.

先查你公司常用出口 IP (用 https://ipinfo.io 或者打开 https://monoi.cn 网页 cmd 跑 `curl ifconfig.me`).

`.env` 加:
```env
ADMIN_IP_WHITELIST=你家 IP,公司 IP,临时移动 IP
```

⚠️ 配这个之前**先确保你 IP 不会变** (家用宽带可能定期换, 移动 IP 必变). 如果不确定, 可以宽放 IP 段:
```env
ADMIN_IP_WHITELIST=192.168.1.0/24
```
(注意当前实现不支持 CIDR, 只精确匹配. 后续 V2 加 CIDR 支持)

不配等于走老行为 (只看 is_admin), 风险中等.

## 3. 不动 env 也加了的防护

启动 main.py 已经默认启用:

- ✅ **登录失败锁定 5 次/15min** — 同邮箱或同手机号 15 分钟内失败 5 次就锁 15 分钟. 暴力破解直接报废
- ✅ **下单端点限流** — 同 IP 1 分钟最多创 10 个支付订单, 防恶意创订单消耗微信 API 配额
- ✅ **CORS 严格** — 不再 `*`, 只白名单域名

## 4. 已有的防护 (之前做过的, 顺便备忘)

- **PBKDF2 密码 hash** 100k 轮 (windows-server/main.py:140)
- **JWT** 7 天过期
- **SQL 注入** 全用参数化查询, 不拼字符串
- **XSS** React 默认 escape, 没有 dangerouslySetInnerHTML
- **SMS 防刷** 手机号 60s 冷却 + IP 1 小时 5 次 + 阿里云 Captcha (env-gated)
- **OSS key 校验** 上传文件路径不能穿越

## 5. 下一阶段 (V2)

下次安全加固建议加:

- **管理员两步验证 (TOTP)** — Google Authenticator 6 位码, 防 admin 密码被盗
- **敏感操作审计 log** — 删用户/退款/手工开通 自动入 audit_log 表, 任何人能查
- **DDoS 防护** — 阿里云 WAF (¥4500/月起, 量大才用)
- **rate limit 全 endpoint** — 不只 login/pay, 所有 endpoint 默认套限流中间件

## 6. 验证清单

部署后 cmd 启动应该看到:

```
[cors] 允许 origins: ['https://monoi.cn', 'https://www.monoi.cn', ...]
[security] JWT_SECRET_KEY 从 env 读取 (64 字符)
[security] admin IP 白名单启用: ['x.x.x.x']
[billing] 9 张商业化表已初始化 (CREATE IF NOT EXISTS)
```

或者(没配 env 的 dev 模式):
```
[cors] 允许 origins: ['https://monoi.cn', ...]
[security] ⚠️  JWT_SECRET_KEY 未配置, 用默认硬编码 key
[security] admin IP 白名单未配 (env ADMIN_IP_WHITELIST), 走 is_admin 字段校验即可
```

警告行 ⚠️ 是提醒你生产配 env, dev 时可以忽略.

测试登录失败锁定:
1. 故意打错密码 5 次
2. 第 6 次应该看到 "登录失败次数过多, 请 15 分钟后再试"
3. 等 15 分钟自动解锁
