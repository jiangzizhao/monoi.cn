"""音乐人声分离 (Demucs) 封装. 用 Meta 开源 demucs (htdemucs 模型).

依赖: pip install demucs  (~600MB 含模型, 首次会自动下)
GPU 加速: 自动检测 CUDA (有就用, 没有 CPU 也能跑只是慢 5-10x)

工作流:
1. 输入: mp3 / wav / m4a / flac 等任意常见格式
2. demucs --two-stems=vocals 分离成 vocals.wav + no_vocals.wav (no_vocals 就是 BGM)
3. ffmpeg 把 no_vocals.wav 转 mp3 (省空间, 一般 5-10MB)
4. 上传 OSS, 返签名 URL 给前端下载

Mock 模式 (没装 demucs): 直接返原文件 (不去人声), 让前端流程能跑通.
"""
import os
import shutil
import subprocess
import sys
from typing import Optional, Tuple


def is_demucs_installed() -> bool:
    try:
        import demucs  # noqa: F401
        return True
    except ImportError:
        return False


def detect_gpu() -> bool:
    """检测 PyTorch CUDA 是否可用 (有 GPU demucs 自动用)."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


def separate_vocals(input_path: str, output_dir: str, model: str = 'htdemucs') -> Tuple[str, str]:
    """跑 demucs 分离, 返 (vocals_path, no_vocals_path). 用 --mp3 直接写 mp3 (绕过 torchaudio.save).

    Args:
        input_path: 输入音频文件绝对路径
        output_dir: 输出目录 (会创建 output_dir/<model>/<input_name>/ 子目录)
        model: demucs 模型, 默认 htdemucs (最新最准)

    Raises:
        RuntimeError: demucs 跑失败
    """
    if not is_demucs_installed():
        raise RuntimeError('demucs 未安装, 在 D:\\monoi-server 跑: pip install demucs')

    os.makedirs(output_dir, exist_ok=True)

    # --mp3: demucs 内部用 ffmpeg 直接写 mp3, 绕开 torchaudio.save (新版 torchaudio 要 torchcodec
    # Windows 装不上). 顺便省了我们再 wav→mp3 一步.
    # sys.executable: 保证用跟 voice-server 同一 Python (venv 那个), 不要走系统 python.
    cmd = [
        sys.executable, '-m', 'demucs',
        '-n', model,
        '--two-stems=vocals',
        '--mp3', '--mp3-bitrate=192',
        '-o', output_dir,
        input_path,
    ]
    print(f"[demucs] 开始分离: {os.path.basename(input_path)} (GPU={detect_gpu()}, py={sys.executable})", flush=True)
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    if proc.returncode != 0:
        err = proc.stderr.decode('utf-8', errors='ignore')[-500:]
        raise RuntimeError(f'demucs 失败: {err}')

    # 输出路径: output_dir/<model>/<input_filename_without_ext>/vocals.mp3 + no_vocals.mp3
    input_name = os.path.splitext(os.path.basename(input_path))[0]
    stem_dir = os.path.join(output_dir, model, input_name)
    vocals = os.path.join(stem_dir, 'vocals.mp3')
    no_vocals = os.path.join(stem_dir, 'no_vocals.mp3')
    if not (os.path.exists(vocals) and os.path.exists(no_vocals)):
        raise RuntimeError(f'demucs 跑完但找不到输出文件: {stem_dir}')
    print(f"[demucs] 分离完成: vocals={os.path.getsize(vocals)//1024}KB, bgm={os.path.getsize(no_vocals)//1024}KB", flush=True)
    return vocals, no_vocals


def remove_vocals_to_bgm(input_path: str, output_mp3_path: str, work_dir: Optional[str] = None) -> dict:
    """端到端: 输入音乐文件, 输出去人声 BGM mp3. 返 metadata dict.

    Args:
        input_path: 用户上传的音乐文件
        output_mp3_path: 输出的 BGM mp3 绝对路径
        work_dir: demucs 中间产物目录 (默认 input_path 同目录的 _demucs_work)

    Returns:
        {'gpu': bool, 'duration_seconds': float, 'output_size_kb': int}
    """
    if work_dir is None:
        work_dir = os.path.join(os.path.dirname(input_path), '_demucs_work')

    _, no_vocals_mp3 = separate_vocals(input_path, work_dir)
    # 直接 copy 到目标位置 (demucs 已经输出 mp3, 不用再 ffmpeg 转码)
    shutil.copy(no_vocals_mp3, output_mp3_path)

    # ffprobe 测一下输出时长
    try:
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', output_mp3_path],
            capture_output=True, text=True, timeout=30,
        )
        duration = float(probe.stdout.strip()) if probe.returncode == 0 else 0
    except Exception:
        duration = 0
    # 清掉 demucs 中间产物
    try:
        shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        pass
    return {
        'gpu': detect_gpu(),
        'duration_seconds': duration,
        'output_size_kb': os.path.getsize(output_mp3_path) // 1024,
    }
