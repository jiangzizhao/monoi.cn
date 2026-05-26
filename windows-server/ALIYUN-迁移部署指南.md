# monoi 迁移到阿里云 GPU 服务器部署指南

把家里 Windows + Docker 那套整套搬到阿里云 Linux GPU 服务器. 一站式: 跟 OSS 同家, 内网传输免费, 备案统一.

---

## 0. 决定买什么实例

### 推荐: ecs.gn7i-c8g1.2xlarge (A10 24GB)
- GPU: NVIDIA A10 24GB (够跑 HeyGem 12GB + funasr 500MB + 余量)
- CPU: 8 vCPU
- 内存: 30 GB
- 系统盘: 80 GB ESSD (基础)
- 数据盘: 推荐 200 GB ESSD (装模型 + 临时文件)
- 计费: 包月 ~¥2200-2700/月 (按量 ¥3.5-5/小时)
- 地域: **跟你 OSS bucket 同地域** (深圳, 因为你 monoi-temp 在深圳)

### 不推荐: 4090 / A100
- 4090 阿里云没卖 (个人云算力市场才有)
- A100 ¥10000+/月 太贵, 初期不需要

### 配置选项
- 操作系统: **Ubuntu 22.04 LTS**
- 镜像可选: 阿里云"GPU 加速计算型实例预装 NVIDIA Driver" — 省装驱动的事
- 网络: 专有网络 VPC (默认)
- 带宽: 5 Mbps 起 (出网用流量计费的话不用买带宽)
- 公网 IP: 弹性公网 IP (备案要绑这个)

---

## 1. 买实例 + 基础环境

### 1.1 在阿里云控制台创建实例
1. 登录 https://ecs.console.aliyun.com/
2. 创建实例 → GPU 计算型 → ecs.gn7i-c8g1.2xlarge
3. 操作系统选 "Ubuntu 22.04 64位 (with NVIDIA driver)"
4. 系统盘 80GB ESSD + 数据盘 200GB ESSD
5. 网络: VPC 默认 + 公网 IP (按流量计费, 出网 ¥0.5/GB)
6. 安全组开放端口: 22 (SSH), 80, 443, 18765, 9001, 8383
7. 创建后**记下 ECS 公网 IP**, 改密码 (root + 普通用户)

### 1.2 SSH 登录
```bash
ssh root@<ECS公网IP>
```

### 1.3 验证 GPU 驱动
```bash
nvidia-smi
```
应该看到 A10 24GB.

### 1.4 装 Docker + nvidia-container-toolkit (Linux 比 Windows 顺 10 倍)
```bash
# Docker
curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker

# nvidia-container-toolkit (让 Docker 用 GPU)
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | apt-key add -
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update
apt-get install -y nvidia-container-toolkit
systemctl restart docker

# 验证: 容器内能看到 GPU
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

### 1.5 装 Python + 系统工具
```bash
apt-get install -y python3 python3-pip python3-venv ffmpeg git curl
```

### 1.6 装数据盘 (200GB) 挂载到 /data
```bash
# 看磁盘
lsblk
# 假设数据盘是 /dev/vdb
mkfs.ext4 /dev/vdb
mkdir /data
mount /dev/vdb /data
# 写 fstab 开机自动挂
echo '/dev/vdb /data ext4 defaults 0 0' >> /etc/fstab
```

---

## 2. 部署 HeyGem 数字人 (Docker)

跟你 Windows 上跑的一样, Linux 上更稳.

```bash
mkdir -p /data/heygem
cd /data/heygem

# 拉 docker-compose 配置 (按你的 HEYGEM-部署指南.md)
# 一般是从 GitHub 拉 HeyGem 项目 + 它的 docker-compose.yml
git clone <heygem repo>
docker compose up -d
```

完事 `docker ps` 看容器 Up, `curl http://127.0.0.1:8383` 通了 → 成功.

---

## 3. 部署 voice-server (funasr ASR + CosyVoice)

```bash
mkdir -p /data/monoi-server/models/cosyvoice
cd /data/monoi-server/models/cosyvoice

# 拉项目代码
git clone https://github.com/jiangzizhao/monoi.cn.git temp
cp temp/windows-server/voice-server.py .
cp temp/windows-server/oss_helper.py .
cp temp/windows-server/.env.example .env   # 你自己填值

# 装 venv + 依赖
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn websockets oss2 jwt pyjwt cryptography
pip install funasr modelscope
# CosyVoice 依赖: 按 cosyvoice 官方文档装

# 编辑 .env, 填:
# OSS_ENDPOINT=https://oss-cn-shenzhen.aliyuncs.com  (内网用 oss-cn-shenzhen-internal 免流量)
# OSS_BUCKET=monoi-temp
# OSS_ACCESS_KEY_ID=...
# OSS_ACCESS_KEY_SECRET=...
nano .env

# 跑
python voice-server.py
# 或后台跑:
nohup python voice-server.py > voice-server.log 2>&1 &
```

**省钱关键**: OSS endpoint 改成内网 (`oss-cn-shenzhen-internal.aliyuncs.com`), 同地域内网传输**完全免费**.

---

## 4. 部署 main.py (主 API 网关)

```bash
mkdir -p /data/monoi-server
cd /data/monoi-server

# 拷贝 main.py / billing.py / admin.py / 各种 .py
cp temp/windows-server/*.py .
cp temp/windows-server/desktop_release.example.json desktop_release.json
# 编辑 desktop_release.json, 填真实 OSS URL

# 装依赖
pip install -r requirements.txt   # 或者 pip install fastapi uvicorn requests sqlite pyjwt cryptography Pillow oss2

# 创建数据库目录
mkdir -p data
touch data/monoi.db   # 启动时自动建表

# 跑
nohup python main.py > main.log 2>&1 &

# 验证
curl http://127.0.0.1:18765/api/me
# 应该返 401 未登录 (说明 server 起了)
```

---

## 5. 域名 + HTTPS (Nginx 反向代理)

### 5.1 装 Nginx
```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

### 5.2 配置反向代理
```bash
cat > /etc/nginx/sites-available/monoi.cn <<'EOF'
server {
    listen 80;
    server_name monoi.cn;

    # WebSocket 支持 (funasr 实时 ASR)
    location /ws/ {
        proxy_pass http://127.0.0.1:18765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # 主 API
    location /api/ {
        proxy_pass http://127.0.0.1:18765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # 大文件上传
        client_max_body_size 200M;
        # 数字人 / 转码长任务
        proxy_read_timeout 600;
    }

    # 健康检查
    location / {
        return 200 "monoi backend OK\n";
    }
}
EOF

ln -s /etc/nginx/sites-available/monoi.cn /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5.3 申请 HTTPS 证书 (备案通过后)
```bash
certbot --nginx -d monoi.cn -d api.monoi.cn
# 自动改 nginx config, 加 SSL
```

### 5.4 阿里云 DNS 解析
1. 阿里云控制台 → 域名 → DNS
2. 加 A 记录: `@` → ECS 公网 IP
3. (可选) 加 `api` → ECS 公网 IP, 给后端 API 单独域名

---

## 6. 微信支付 + 阿里云回调

### 6.1 改 .env 里的回调 URL
```
WX_NOTIFY_URL=https://monoi.cn/api/pay/wx/notify
```

### 6.2 微信支付商户后台
- 产品中心 → JSAPI 支付 → 配置支付授权目录: `https://monoi.cn/`
- API 安全 → 通知地址: `https://monoi.cn/api/pay/wx/notify`

---

## 7. 桌面端代码改回 monoi.cn

```bash
# 在你 Mac 上
git checkout phase4-electron
# 改 electron/main.ts:
# const MONOI_URL = process.env.MONOI_URL || 'https://monoi.cn'
git commit + push
# 下次 pack:win 出的桌面端就走 monoi.cn
```

---

## 8. 系统服务化 (开机自启 + 崩了自动重启)

### 8.1 voice-server.service
```bash
cat > /etc/systemd/system/voice-server.service <<'EOF'
[Unit]
Description=monoi voice-server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/data/monoi-server/models/cosyvoice
ExecStart=/data/monoi-server/models/cosyvoice/venv/bin/python voice-server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl enable voice-server
systemctl start voice-server
```

### 8.2 main.service
同上, WorkingDirectory 改成 `/data/monoi-server`, ExecStart 改成 `python3 main.py`.

### 8.3 验证
```bash
systemctl status voice-server
systemctl status main
```

崩了会自动重启, 不用人管.

---

## 9. 监控 + 日志

### 9.1 看日志
```bash
journalctl -u voice-server -f
journalctl -u main -f
```

### 9.2 阿里云云监控
- ECS 控制台 → 监控告警
- CPU > 80%, 内存 > 90%, 磁盘 > 80% 时发短信给你

---

## 10. 备份 / 灾备

### 10.1 monoi.db (用户数据) 定时备份到 OSS
```bash
# crontab -e 加一行 (每天凌晨 3 点备份)
0 3 * * * aws s3 cp /data/monoi-server/data/monoi.db oss://monoi-temp/backups/monoi-$(date +\%Y\%m\%d).db
```

(或者用 ossutil 命令)

### 10.2 关键 .env 离线备份
打印一份贴在你笔记本里 (或加密存网盘).

---

## 11. 关掉家里 Windows 服务器

云上一切跑通了 → 测试 1-2 天没问题 → 家里 Windows:
- 把 monoi.db 备份到 OSS 一份 (跟云上的合并)
- 关 NATAPP
- 关 Python 服务
- Windows 可以关机了 (本地开发 / 录屏 .exe 打包时再开)

---

## 月度成本估算 (深圳地域)

| 项 | 单价 | 月费 |
|---|---|---|
| ecs.gn7i-c8g1.2xlarge (A10) | 包月 | **¥2200-2700** |
| 系统盘 80GB ESSD | ¥0.4/GB/月 | ¥32 |
| 数据盘 200GB ESSD | ¥0.4/GB/月 | ¥80 |
| 弹性公网 IP | ¥10/月 | ¥10 |
| 出网流量 (按 200GB/月) | ¥0.5/GB | ¥100 |
| **小计** | | **~¥2400-3000/月** |

**回本点**: 12-15 个 Max 用户 (¥199/月).

---

## 风险记录

1. **首次部署 HeyGem 容易踩坑** — Docker compose / GPU 驱动 / 显存. 慢慢调.
2. **funasr 模型 500MB 首次下载** — 给国内镜像 (modelscope 国内速度 OK)
3. **CosyVoice 依赖复杂** — 按 CosyVoice 官方文档来, 别瞎装
4. **OSS endpoint 必须用内网域名** (`-internal.aliyuncs.com`) — 不然出网流量收一遍钱
5. **域名备案下来才能 HTTPS** — 备案前先用 IP + HTTP 测

---

## 部署完检查清单

- [ ] `curl http://127.0.0.1:8383` (HeyGem)
- [ ] `curl http://127.0.0.1:9001/health` (voice-server)
- [ ] `curl http://127.0.0.1:18765/api/me` (main, 401 也算通)
- [ ] `curl https://monoi.cn/api/me` (Nginx + HTTPS)
- [ ] WebSocket: 网页闪说 tab 能连 ws + funasr 转写
- [ ] OSS: 前端能下载封面 / BGM
- [ ] 微信支付: 测试单笔 ¥0.01 通到回调
- [ ] systemd: `reboot` 后所有服务自动起

---

部署遇到问题随时问我, 我帮你调.
