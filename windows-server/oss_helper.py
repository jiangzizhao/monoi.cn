"""阿里云 OSS 临时中转 (短暂上传 + 下载, 不做长期存储).

设计:
- bucket 设 lifecycle 规则: uploads/ 和 outputs/ 前缀 1 天自动删, 不积成本
- bucket 设 private (浏览器只能用签名 PUT/GET URL, 不能裸读取)
- 浏览器 → 拿后端签名 PUT URL → 直传 OSS (走 OSS 公网带宽, ~10 MB/s)
- 服务器 → 从 OSS 拉 → 处理 → 输出再传回 OSS → 返回签名 GET URL 给前端

环境变量 (放 .env):
  OSS_ENDPOINT        e.g. https://oss-cn-shanghai.aliyuncs.com
  OSS_BUCKET          e.g. monoi-temp
  OSS_REGION          e.g. cn-shanghai (用于 v4 签名)
  OSS_ACCESS_KEY_ID   AccessKey ID (推荐用 RAM 子账号, 只给 oss:PutObject/GetObject/DeleteObject 权限)
  OSS_ACCESS_KEY_SECRET
  (兼容: 没设就回退到 ALIYUN_AK_ID / ALIYUN_AK_SECRET)

用法:
  from oss_helper import oss_sign_put, oss_download, oss_upload, oss_sign_get, oss_delete
"""
import os
import time
import uuid

_BUCKET_CACHE = None
_ENV_LOADED = False


def _try_load_env():
    """voice-server 跑在 cosyvoice 目录, .env 在 D:\\monoi-server\\, 主动加载.
    main.py 已经加载过的话, os.environ 已有, 这里 setdefault 不会覆盖."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, ".env"),                  # oss_helper 同目录
        os.path.join(here, "..", "..", ".env"),      # cosyvoice 往上 2 层 → monoi-server/
        os.path.join(here, "..", ".env"),            # 上 1 层
        r"D:\monoi-server\.env",                     # 硬编码兜底
    ]
    for path in candidates:
        path = os.path.abspath(path)
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
            print(f"[oss_helper] 加载 .env: {path}", flush=True)
            return
        except Exception as e:
            print(f"[oss_helper] 加载 .env 失败 ({path}): {e}", flush=True)


def _get_bucket():
    """懒加载 oss2 bucket 句柄. 没装 oss2 或没配 key 时抛 RuntimeError."""
    global _BUCKET_CACHE
    if _BUCKET_CACHE is not None:
        return _BUCKET_CACHE

    _try_load_env()

    try:
        import oss2
    except ImportError:
        raise RuntimeError("缺少 oss2 库, 请 pip install oss2")

    endpoint = os.environ.get("OSS_ENDPOINT", "").strip()
    bucket_name = os.environ.get("OSS_BUCKET", "").strip()
    ak_id = os.environ.get("OSS_ACCESS_KEY_ID", "").strip() or os.environ.get("ALIYUN_AK_ID", "").strip()
    ak_secret = os.environ.get("OSS_ACCESS_KEY_SECRET", "").strip() or os.environ.get("ALIYUN_AK_SECRET", "").strip()

    if not endpoint or not bucket_name or not ak_id or not ak_secret:
        raise RuntimeError(
            "OSS 未配置. 需要在 .env 设 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET"
        )

    auth = oss2.Auth(ak_id, ak_secret)
    _BUCKET_CACHE = oss2.Bucket(auth, endpoint, bucket_name)
    return _BUCKET_CACHE


def oss_is_configured() -> bool:
    """是否已配 OSS (用于功能开关)"""
    try:
        _get_bucket()
        return True
    except RuntimeError:
        return False


def oss_make_upload_key(filename: str, prefix: str = "uploads") -> str:
    """生成上传用 OSS key. 加随机前缀避免冲突 + 保留扩展名."""
    safe = os.path.basename(filename or "file").replace(" ", "_")
    ext = os.path.splitext(safe)[1] or ".bin"
    return f"{prefix}/{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"


def oss_sign_put(oss_key: str, content_type: str = "application/octet-stream", expires: int = 3600) -> str:
    """生成 PUT 签名 URL (浏览器直传用). 默认 1 小时有效."""
    bucket = _get_bucket()
    return bucket.sign_url("PUT", oss_key, expires, headers={"Content-Type": content_type}, slash_safe=True)


def oss_sign_get(oss_key: str, expires: int = 6 * 3600) -> str:
    """生成 GET 签名 URL (浏览器播放/下载用). 默认 6 小时有效."""
    bucket = _get_bucket()
    return bucket.sign_url("GET", oss_key, expires, slash_safe=True)


def oss_download(oss_key: str, local_path: str) -> None:
    """从 OSS 下载到本地文件."""
    bucket = _get_bucket()
    bucket.get_object_to_file(oss_key, local_path)


def oss_upload(oss_key: str, local_path: str, content_type: str = "video/mp4") -> None:
    """从本地文件上传到 OSS."""
    bucket = _get_bucket()
    headers = {"Content-Type": content_type}
    bucket.put_object_from_file(oss_key, local_path, headers=headers)


def oss_delete(oss_key: str) -> None:
    """删除 OSS 上的对象 (吞异常, 删不掉就让 lifecycle 规则兜底)."""
    try:
        bucket = _get_bucket()
        bucket.delete_object(oss_key)
    except Exception as e:
        print(f"[oss_delete] 失败但忽略: {oss_key} - {e}", flush=True)
