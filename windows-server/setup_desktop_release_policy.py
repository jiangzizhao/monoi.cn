"""
一次性: 给 OSS bucket 加一条策略, 允许任何人 (匿名) 下载 desktop_release/ 下的文件.
其他 prefix (covers / BGM / 录屏等) 不受影响, 还是走签名 URL 私有访问.

用法 (Windows 跑一次就够):
    cd /d D:\\monoi-server
    python setup_desktop_release_policy.py

跑完后:
- https://{bucket}.{endpoint}/desktop_release/anything.exe 直接能下 (没 AccessDenied)
- 其他路径仍然私有 (匿名访问报错), 保持安全
"""
import json
import os
import sys


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from oss_helper import _get_bucket  # type: ignore

    bucket = _get_bucket()
    bucket_name = bucket.bucket_name
    print(f"✓ OSS 连上 (bucket: {bucket_name})")

    # 策略: 任何 principal (* = 匿名 + 所有用户) 可 GetObject desktop_release/* 下的对象
    policy = {
        "Version": "1",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": ["*"],
                "Action": ["oss:GetObject"],
                "Resource": [f"acs:oss:*:*:{bucket_name}/desktop_release/*"],
            }
        ],
    }
    policy_str = json.dumps(policy, ensure_ascii=False)
    print(f"准备应用策略:\n{json.dumps(policy, ensure_ascii=False, indent=2)}\n")

    try:
        bucket.put_bucket_policy(policy_str)
        print("✓ 策略已生效")
        print(f"\n验证: 浏览器开下面 URL 应该能下 (或返 404 表示文件不存在但 ACL 通了):")
        endpoint = bucket.endpoint.replace("https://", "").replace("http://", "")
        print(f"  https://{bucket_name}.{endpoint}/desktop_release/monoi-Setup-0.1.0.exe")
    except Exception as e:
        msg = str(e)
        print(f"✗ 设策略失败: {msg}")
        print("\n常见原因:")
        print("- RAM 用户没 PutBucketPolicy 权限 → 让 owner 跑这个脚本, 或控制台手动设")
        print("- 或者去 OSS 控制台:")
        print(f"  bucket: {bucket_name} → 权限管理 → Bucket 策略 → 添加")
        print("  资源 desktop_release/*, 操作 oss:GetObject, 主体 *, 效果 允许")
        sys.exit(1)


if __name__ == "__main__":
    main()
