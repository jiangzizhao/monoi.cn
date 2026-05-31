# monoi.cn 阿里云部署 — main.py + Nginx + HTTPS

这一步把后端 main.py(含迁入的 Vercel api)在云上 T4 跑起来,Nginx 反代 + HTTPS。
前置:voice-server(9001)/ index-server(9002)/ 数字人(8383)已 systemd 在跑;swap 已加。

服务器:`ssh root@39.108.121.30`(密钥免密)。工作目录 `/data/monoi-server/`。

---

## 1. 同步代码 + 建 venv(若昨天已建好则跳过建)

```bash
cd /data/monoi-server
# 拉最新 windows-server 下的 .py
rm -rf monoi-repo && git clone --depth 1 https://github.com/jiangzizhao/monoi.cn.git monoi-repo
cp monoi-repo/windows-server/*.py /data/monoi-server/
# venv (若已存在跳过)
[ -x /data/monoi-server/venv/bin/python ] || python3 -m venv /data/monoi-server/venv
```

## 2. 装依赖

```bash
source /data/monoi-server/venv/bin/activate
pip install --upgrade pip
pip install fastapi 'uvicorn[standard]' 'python-jose[cryptography]' pydantic requests \
            python-multipart websockets oss2 aliyun-python-sdk-core aliyun-python-sdk-kms Pillow
```

> 重型依赖(playwright / openai-whisper / yt-dlp,供 /api/fetch 抖音抓取)先不装,
> main.py 能起、登录/积分/AI/配音调度都能用;抓取功能后补。

## 3. 配 .env

```bash
cp /data/monoi-server/monoi-repo/windows-server/deploy/env.example /data/monoi-server/.env
nano /data/monoi-server/.env   # 把空的 key 从家里 D:\monoi-server\.env 抄过来
```

最少要填能起来 + 核心功能:`DEEPSEEK_API_KEY`、`OSS_*`、`ALIYUN_CAPTCHA_*`、`PEXELS/PIXABAY`。
短信先 `SMS_FORCE_MOCK=1` 跳过;支付(WX/Alipay)等 DNS 上线后再配。
`JWT_SECRET_KEY` 模板里已填好强随机值。

## 4. ⚠️ 迁 users.db(切 DNS 前必须做,保留用户+积分)

从家里 Windows 把 `D:\monoi-server\users.db` 传到云上 `/data/monoi-server/users.db`。
(家里那台跑着的话先停 main.py 再拷,避免拷到写一半的库。)

## 5. systemd 起 main.py

```bash
cp /data/monoi-server/monoi-repo/windows-server/deploy/main-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now main-server.service
sleep 5
systemctl is-active main-server.service
ss -tlnp | grep 18765
curl -s http://127.0.0.1:18765/api/... # 找个轻量接口验
journalctl -u main-server -n 30 --no-pager   # 看启动日志有无报错
```

## 6. Nginx + HTTPS

```bash
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
cp /data/monoi-server/monoi-repo/windows-server/deploy/nginx-monoi.conf /etc/nginx/sites-available/monoi
ln -sf /etc/nginx/sites-available/monoi /etc/nginx/sites-enabled/monoi
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
# DNS 把 api.monoi.cn A 记录指到 39.108.121.30 之后, 再申证书:
certbot --nginx -d api.monoi.cn
```

## 7. DNS(阿里云云解析)

- `api.monoi.cn`  A  → `39.108.121.30`
- `monoi.cn` / `www`  → CDN(回源 OSS monoi-cn)
- 前端 GitHub Action secret `VITE_DIRECT_API_URL=https://api.monoi.cn` → 重新 build 部署 OSS

## 8. 收尾

- 字体:把家里 `D:\monoi-server\fonts\*` 传到 `/data/monoi-server/fonts/`(/api/font 用)
- 微信/支付宝证书 .pem → `/data/monoi-server/certs/`
- EIP 带宽 100 → 5 Mbps
- 桌面端 MONOI_URL → https://monoi.cn 重新发版
