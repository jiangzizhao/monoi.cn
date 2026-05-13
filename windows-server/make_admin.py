"""把某个账号设为 admin (一键脚本).

用法:
  cd D:\monoi-server
  python make_admin.py

会列出所有用户, 你输入序号选哪个设为 admin, 完成. 没参数也行, 交互式选.

进阶: python make_admin.py 邮箱@xxx.com   # 按邮箱
       python make_admin.py 13800138000     # 按手机号
       python make_admin.py 用户名           # 按用户名
"""

import sqlite3
import sys

DB = "monoi.db"


def list_and_pick():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, username, email, phone, is_admin FROM users ORDER BY id"
    ).fetchall()
    if not rows:
        print("数据库里还没用户. 先去前端注册一个再来.")
        return
    print(f"\n当前 {len(rows)} 个用户:\n")
    for r in rows:
        flag = " [admin]" if r['is_admin'] else ""
        phone = r['phone'] or '-'
        print(f"  [{r['id']}] {r['username']:<15} {r['email']:<30} {phone}{flag}")
    print()
    choice = input("输入要设为 admin 的用户 id (或 'all' 把所有人都设为 admin): ").strip()
    if not choice:
        print("取消")
        return
    if choice.lower() == 'all':
        conn.execute("UPDATE users SET is_admin = 1")
        conn.commit()
        print(f"✓ 已把所有 {len(rows)} 个用户设为 admin")
    else:
        try:
            uid = int(choice)
        except ValueError:
            print(f"无效 id: {choice}")
            return
        cur = conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (uid,))
        conn.commit()
        if cur.rowcount == 0:
            print(f"✗ 没找到 id={uid} 的用户")
        else:
            row = conn.execute("SELECT username, email FROM users WHERE id = ?", (uid,)).fetchone()
            print(f"✓ user_id={uid} ({row['username']}, {row['email']}) 已设为 admin")
            print("现在退出登录重新登一次, sidebar 底部就有'管理后台'链接")
    conn.close()


def pick_by_arg(arg: str):
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    # 按邮箱 / 手机 / 用户名 / id 找
    rows = conn.execute("""
        SELECT id, username, email, phone FROM users
        WHERE email = ? OR phone = ? OR username = ? OR CAST(id AS TEXT) = ?
    """, (arg, arg, arg, arg)).fetchall()
    if len(rows) == 0:
        print(f"✗ 没找到匹配的用户: {arg}")
        return
    if len(rows) > 1:
        print(f"⚠ 找到多个匹配:")
        for r in rows:
            print(f"  [{r['id']}] {r['username']} {r['email']} {r['phone']}")
        print("用 id 数字精确指定")
        return
    r = rows[0]
    conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (r['id'],))
    conn.commit()
    print(f"✓ user_id={r['id']} ({r['username']}) 已设为 admin")
    print("现在退出登录重新登一次")
    conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        pick_by_arg(sys.argv[1])
    else:
        list_and_pick()
