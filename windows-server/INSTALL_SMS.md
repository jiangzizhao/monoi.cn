# 阿里云短信集成 (Windows 后端)

> 当前默认是 mock 模式 (控制台打印验证码, 用户收不到真短信). 准备上线给真用户用时, 按这文档接阿里云.

## 1. 装 SDK

在 `D:\monoi-server` 跑:

```bat
pip install alibabacloud_dysmsapi20170525 alibabacloud_tea_openapi
```

依赖大约 3-5 MB, 装完不影响其他模块.

## 2. 拉新版代码

```bat
cd /d D:\monoi-server
curl -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/sms_aliyun.py
curl -O https://raw.githubusercontent.com/jiangzizhao/monoi.cn/main/windows-server/main.py
```

## 3. 配 .env (放在 D:\monoi-server\.env)

7 个变量都要填:

```env
# AccessKey (RAM 用户 monoi-sms, 权限 AliyunDysmsFullAccess)
ALIYUN_SMS_ACCESS_KEY_ID=LTAI4G...
ALIYUN_SMS_ACCESS_KEY_SECRET=你的Secret

# 短信签名名称 (阿里云审批通过后的, 例 monoi)
ALIYUN_SMS_SIGN_NAME=monoi

# 4 个模板 CODE (审批通过后从 短信服务 > 模板管理 > 详情 拿)
SMS_TEMPLATE_REGISTER=SMS_xxxxxxxx
SMS_TEMPLATE_LOGIN=SMS_xxxxxxxx
SMS_TEMPLATE_RESET_PASSWORD=SMS_xxxxxxxx
SMS_TEMPLATE_REBIND_PHONE=SMS_xxxxxxxx
```

## 4. 重启 main.py

```bat
:: 关掉旧的 main.py 进程
:: 重新启动 main.py
```

启动时控制台会打印一行:
```
[sms] mode = REAL (阿里云)
```

看到 REAL 就 OK 了, 真用户能收到短信. 看到 `MOCK (控制台打印)` 说明 env 没填齐, 自动 fallback 到 mock.

## 5. 验证

注册一个测试账号, 用真手机号. 应该:
- 手机收到短信: `【monoi】您的验证码 123456, 5 分钟内有效, 请勿告知他人.`
- 验证码填进去能注册成功

如果没收到:
- 看 main.py 控制台是否打印 `[sms-real] 已发送给 xxx (用途: register)` — 这是已经调用阿里云了
- 如果打印 `[sms-real] 发送失败 ... 阿里云返回 XXX: 错误信息` — 是阿里云那边的错, 按提示处理:
  - `isv.SIGN_NOT_MATCH_WITH_TEMPLATE` — 签名跟模板对不上, 检查模板审批时绑定的签名
  - `isv.BUSINESS_LIMIT_CONTROL` — 同一个号被限流, 等 1 小时
  - `isv.MOBILE_NUMBER_ILLEGAL` — 手机号格式错
  - `isv.SMS_TEST_NUMBER_LIMIT` — 未充值, 只能发到测试号

## 6. 切回 mock 模式

如果想临时切回 mock 测试 (不发真短信, 省 ¥0.045/条):

```env
SMS_FORCE_MOCK=1
```

加到 .env 重启即可. 即使其他 env 都齐了也强制 mock.

## 7. 成本估算

- 阿里云国内短信验证码 ¥0.045/条
- 1000 用户注册 = ¥45
- 1000 次登录 = ¥45
- 一个用户全生命周期 (注册 + 5 次登录 + 1 次找回密码) ≈ ¥0.32
- 100 月活用户的话, 短信月成本估算 < ¥30

## 8. 安全

- AccessKey Secret **永远不要 commit 到 git**, 只放 Windows .env
- 不要给 RAM 用户除 `AliyunDysmsFullAccess` 之外的权限
- 万一 AccessKey 泄漏: 阿里云 → RAM → 用户 → AccessKey → **禁用 / 删除**, 立刻重建一个

## 9. 失败防御

如果阿里云调用失败 (网络抖动 / 限流 / 余额不足), main.py 会 raise HTTPException 500 给前端, 用户看到"短信发送失败". 控制台 log 会写具体原因 (`[sms-real] 发送失败 ...`).

**重要**: 即使阿里云调用失败, 验证码**已经写进 sms_codes 表**了. 如果用户重试还是同一个号 (60 秒冷却内), 会被冷却拦截. 让用户**过 1 分钟再点发送**, 会生成新 code 再次尝试发送.
