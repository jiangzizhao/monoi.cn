"""
桌面版 .exe + latest.yml + .blockmap 一键上传到 OSS + 设公共读 + 输出 URL.

用法 (Windows):
    cd /d D:\\monoi-server
    python upload_desktop_release.py D:\\monoi-electron\\release\\monoi-Setup-0.1.0.exe

会:
1. 读 .env 拿 OSS 凭据
2. 把 .exe + latest.yml + .blockmap 三个文件一起上传到 oss://{bucket}/desktop_release/
3. 设 public-read ACL (匿名能下)
4. 打印公开 URL + desktop_release.json 模板

.blockmap 给 electron-updater 做差量更新 (老用户升级只下 5MB 不是 80MB).
没 blockmap 也不致命, 只是浪费流量.

之后只需要把 JSON 内容写到 D:\\monoi-server\\desktop_release.json, 重启 Python.
"""
import os
import sys
import json
import time
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        print("用法: python upload_desktop_release.py <path/to/monoi-Setup-X.X.X.exe>")
        print("脚本会自动找同目录的 latest.yml 一起上传.")
        sys.exit(1)

    exe_path = Path(sys.argv[1])
    if not exe_path.exists():
        print(f"✗ .exe 不存在: {exe_path}")
        sys.exit(1)

    yml_path = exe_path.parent / "latest.yml"
    if not yml_path.exists():
        print(f"⚠️ latest.yml 不存在 (没它自动更新不工作): {yml_path}")
        print("  仍继续, 只传 .exe.")

    # 跟 main.py 同目录, 复用 oss_helper
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from oss_helper import _get_bucket  # type: ignore

    bucket = _get_bucket()
    print(f"✓ OSS 连上 (bucket: {bucket.bucket_name}, endpoint: {bucket.endpoint})")

    # 解析版本号 (从 .exe 文件名). monoi-Setup-0.1.0.exe → 0.1.0
    fname = exe_path.name
    try:
        version = fname.replace("monoi-Setup-", "").replace(".exe", "")
    except Exception:
        version = "unknown"
    print(f"✓ 解析版本号: {version}")

    # 上传文件 + 设 public-read
    def upload_one(local_path: Path, oss_key: str):
        size_mb = local_path.stat().st_size / 1024 / 1024
        print(f"  上传 {local_path.name} ({size_mb:.1f} MB) → {oss_key} ...")
        bucket.put_object_from_file(oss_key, str(local_path))
        # 设 public-read ACL (匿名能下)
        try:
            import oss2
            bucket.put_object_acl(oss_key, oss2.OBJECT_ACL_PUBLIC_READ)
            print(f"  ✓ {oss_key} 已设公共读")
        except Exception as e:
            print(f"  ⚠️ 设 ACL 失败 (可能 RAM 没 PutObjectAcl 权限): {e}")
            print(f"     去 OSS 控制台手动设 desktop_release/ 公共读, 或忽略 (bucket 整体公共读的话不用)")

    exe_key = f"desktop_release/{exe_path.name}"
    upload_one(exe_path, exe_key)

    if yml_path.exists():
        upload_one(yml_path, "desktop_release/latest.yml")

    # blockmap 用于 electron-updater 差量下载 (新版只下改动的字节, 老用户升级 5MB 不是 80MB).
    # 没传 blockmap, updater 会 fallback 下整个 .exe — 功能上能用但浪费流量.
    blockmap_path = exe_path.parent / f"{exe_path.name}.blockmap"
    if blockmap_path.exists():
        upload_one(blockmap_path, f"desktop_release/{blockmap_path.name}")
    else:
        print(f"⚠️ blockmap 不存在: {blockmap_path}")
        print("  没它老用户升级会下载整个 .exe (~80MB), 而不是差量 (~5MB). 不致命但费流量.")

    # 构造公开 URL
    endpoint = bucket.endpoint.replace("https://", "").replace("http://", "")
    public_base = f"https://{bucket.bucket_name}.{endpoint}"
    exe_url = f"{public_base}/{exe_key}"

    print("\n" + "=" * 60)
    print("✓ 上传完成!")
    print(f"\n.exe 公开 URL:\n  {exe_url}\n")
    print("浏览器开这个 URL 应该弹下载 (验证 ACL 生效).\n")
    print("现在把下面内容写到 D:\\monoi-server\\desktop_release.json:")
    print("-" * 60)
    print(json.dumps({
        "version": version,
        "exe_url": exe_url,
        "size_mb": round(exe_path.stat().st_size / 1024 / 1024, 1),
        "released_at": time.strftime("%Y-%m-%d"),
        "notes": f"v{version} 更新内容 (改这里写发版说明给用户看)",
    }, ensure_ascii=False, indent=2))
    print("-" * 60)
    print("\n保存后 taskkill /F /IM python.exe + 双击 一键启动.bat, 完事.")
    print(f"前端验证: curl https://monoi.nat100.top/api/desktop/latest")


if __name__ == "__main__":
    main()
