"""
剪映草稿生成 (V1 最小版): 按句分段视频/字幕 + 整段口播音频, 打 zip 给用户下载.

依赖: pip install pyJianYingDraft  (可选, 没装时 endpoint 会报清楚错误)

数据结构上跟 /compose-footage 完全对齐: 每个 shot = 一镜 = (start, end, 该镜素材路径).
草稿打开后用户在剪映里看到的是已经按句子分好段的 3 条轨道:
  - 视频轨: 每句一段 (没素材的句子用口播视频画面 fallback, 跟 ffmpeg 合成时一致)
  - 音频轨: 1 段, 整条 narration 音轨
  - 字幕轨: 每句一段
"""
import os
import json
import shutil
import subprocess
from typing import Optional


# 剪映草稿引用素材时, 我们用相对路径 (相对于草稿目录的 materials/), 这样 zip 跨机器仍可用.
# 实测剪映对 path 的处理: 优先按 path 找文件, 找不到时按草稿目录同级目录找 — 所以相对路径能用.
_MATERIALS_DIRNAME = 'materials'

_RATIO_DIMS = {
    '9:16': (1080, 1920),
    '16:9': (1920, 1080),
    '3:4':  (1080, 1440),
    '1:1':  (1080, 1080),
}


def _check_pyjianying():
    try:
        import pyJianYingDraft  # noqa: F401
        return pyJianYingDraft
    except ImportError as e:
        raise RuntimeError(
            "pyJianYingDraft 未安装. 在 D:\\monoi-server 跑: pip install pyJianYingDraft"
        ) from e


def _ffprobe_duration(path: str) -> float:
    proc = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True, timeout=30,
    )
    if proc.returncode != 0:
        return 0.0
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def _rewrite_paths_to_relative(json_path: str, abs_materials_dir: str) -> None:
    """draft_content.json 里素材路径 (pyJianYingDraft 默认存绝对路径) 全部改成相对的
    `materials/xxx.mp4`, 让用户在自己机器上解压 zip 后剪映也能找到."""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    abs_norm = abs_materials_dir.replace('\\', '/').rstrip('/')

    def fix(obj):
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                if isinstance(v, str):
                    v_norm = v.replace('\\', '/')
                    if v_norm.startswith(abs_norm + '/'):
                        rel = v_norm[len(abs_norm) + 1:]
                        obj[k] = f'{_MATERIALS_DIRNAME}/{rel}'
                    elif v_norm == abs_norm:
                        obj[k] = _MATERIALS_DIRNAME
                else:
                    fix(v)
        elif isinstance(obj, list):
            for item in obj:
                fix(item)

    fix(data)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def build_draft_zip(
    *,
    work_dir: str,
    draft_name: str,
    narration_video_path: str,
    shots: list,
    output_ratio: str = '9:16',
) -> str:
    """生成剪映草稿目录 + 打 zip. shots 每项:
       - start, end (s): 在 narration 中的时间
       - asset_path: 该镜素材本地路径; None = 用 narration 画面 fallback
       - asset_duration (s): 素材文件原长 (用于 source_timerange)
       - text: 该镜字幕 (空字符串 = 不加这段字幕)
    返回生成的 zip 路径 (在 work_dir 下)."""
    pjd = _check_pyjianying()
    if output_ratio not in _RATIO_DIMS:
        raise ValueError(f'不支持的 output_ratio: {output_ratio}')
    W, H = _RATIO_DIMS[output_ratio]

    draft_dir = os.path.join(work_dir, draft_name)
    materials_dir = os.path.join(draft_dir, _MATERIALS_DIRNAME)
    os.makedirs(materials_dir, exist_ok=True)

    # 1. 提 narration 音轨成独立 m4a (剪映 AudioSegment 用; 视频里抽出来更干净, 不带画面)
    narration_audio = os.path.join(materials_dir, 'narration.m4a')
    proc = subprocess.run(
        ['ffmpeg', '-y', '-i', narration_video_path, '-vn', '-c:a', 'aac', '-b:a', '192k', narration_audio],
        capture_output=True, timeout=180,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode('utf-8', errors='ignore')[-400:]
        raise RuntimeError(f'ffmpeg 提音轨失败: {err}')

    total_dur_s = _ffprobe_duration(narration_video_path)
    if total_dur_s <= 0:
        raise RuntimeError('无法读取 narration 视频时长')

    # 2. 复制 narration 视频本身 (作为 fallback 视频源, 没匹配到 b-roll 的句子用它的画面)
    narration_video_local = os.path.join(materials_dir, 'narration.mp4')
    shutil.copy(narration_video_path, narration_video_local)

    # 3. 复制每镜 asset 到 materials 目录
    shot_local_paths: list[Optional[str]] = []
    for i, shot in enumerate(shots):
        ap = shot.get('asset_path')
        if ap and os.path.isfile(ap):
            ext = os.path.splitext(ap)[1] or '.mp4'
            local = os.path.join(materials_dir, f'shot_{i:03d}{ext}')
            shutil.copy(ap, local)
            shot_local_paths.append(local)
        else:
            shot_local_paths.append(None)

    # 4. 构造 ScriptFile + 3 条轨道
    # pyJianYingDraft 0.2.x 起 ScriptFile 多两个必填: fps 默认 30, maintrack_adsorb 主轨吸附 (True 跟剪映默认行为一致)
    script = pjd.ScriptFile(W, H, fps=30, maintrack_adsorb=True)
    V_TRACK = 'video_main'
    A_TRACK = 'audio_narration'
    T_TRACK = 'subtitle'
    script.add_track(pjd.TrackType.video, V_TRACK)
    script.add_track(pjd.TrackType.audio, A_TRACK)
    script.add_track(pjd.TrackType.text, T_TRACK)

    # 4a. 音频轨: 整段 narration
    audio_seg = pjd.AudioSegment(narration_audio, pjd.trange('0s', f'{total_dur_s}s'))
    script.add_segment(audio_seg, A_TRACK)

    # 4b. 视频轨 + 字幕轨: 每镜一段
    for i, shot in enumerate(shots):
        start_s = float(shot['start'])
        end_s = float(shot['end'])
        dur_s = max(0.1, end_s - start_s)
        text = (shot.get('text') or '').strip()

        target = pjd.trange(f'{start_s}s', f'{dur_s}s')

        if shot_local_paths[i]:
            asset_dur = float(shot.get('asset_duration') or dur_s)
            take_dur = min(dur_s, max(0.5, asset_dur))
            video_seg = pjd.VideoSegment(
                shot_local_paths[i],
                target,
                source_timerange=pjd.trange('0s', f'{take_dur}s'),
            )
        else:
            # fallback: 用 narration 视频对应那段的画面
            video_seg = pjd.VideoSegment(
                narration_video_local,
                target,
                source_timerange=pjd.trange(f'{start_s}s', f'{dur_s}s'),
            )
        script.add_segment(video_seg, V_TRACK)

        if text:
            text_seg = pjd.TextSegment(text, target)
            script.add_segment(text_seg, T_TRACK)

    # 5. 保存 draft_content.json
    json_path = os.path.join(draft_dir, 'draft_content.json')
    script.dump(json_path)

    # 6. 把 JSON 里的素材绝对路径改成 `materials/xxx`, 这样 zip 跨机器有效
    _rewrite_paths_to_relative(json_path, materials_dir)

    # 7. 打 zip
    zip_base = os.path.join(work_dir, draft_name)
    zip_path = shutil.make_archive(zip_base, 'zip', root_dir=work_dir, base_dir=draft_name)
    return zip_path
