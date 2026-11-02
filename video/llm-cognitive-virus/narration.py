"""Synthesize the narration scene by scene and write build/timeline.json.

Each scene is one TTS call. `{cue}` markers in the text name the next word, so the
renderer and the sound mix can key animations to the moment that word is spoken.
"""
import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

VOICE = "vi-VN-NamMinhNeural"
RATE, PITCH = "-2%", "-6Hz"  # a little slower and lower: calmer, warmer
LEAD, GAP, TAIL = 0.7, 0.3, 2.7  # seconds: music-only intro, pause between scenes, end card

SCENES = [
    ("hook", "Nếu thói quen để {ai}AI nghĩ hộ {spread}lây lan như virus, {title}xã hội sẽ ra sao?"),
    ("source", "Một nhóm nhà khoa học đã {model}mô hình hóa điều đó bằng {epi}toán học của dịch tễ."),
    ("states", "Mỗi người ở một trong ba trạng thái: {U}tự chủ, {C}dùng có kiểm soát, hoặc {D}lệ thuộc."),
    ("forces", "Hai lực {tug}giằng co: {lam}sức lây lam-đa kéo người ta dùng AI, còn {kap}sức kéo tập thể "
               "kéo người ta về tự nghĩ, mạnh theo {sq}bình phương số người tự chủ. Họ {thin}thưa đi, nó {weak}yếu rất nhanh."),
    ("demo", "{up}Tăng dần lam-đa. Tới {at45}0,45, {nothing}chưa có gì. {cross}Vượt 0,5, cả quần thể {flip}lật. "
             "{down}Hạ về 0,45, {stay}không quay lại. Phải {below}dưới 0,4 mới {recover}hồi phục."),
    ("why", "{two}Hai ngưỡng khác nhau, nên {loop}đường đi khác đường về: {hyst}hiện tượng trễ. "
            "{gamma}Năng lực tự làm khi bỏ công cụ {drop}rơi hơn một nửa."),
    ("take", "Bài học: {f1}thay đổi có thể đột ngột, {f2}khó đảo ngược, nên {f3}phòng dễ hơn chữa. "
             "{caveat}Mô hình chỉ là lý thuyết, nhưng hãy tự hỏi: "
             "{q}bỏ công cụ đi, mình còn lại gì?"),
]

# Spoken form -> on-screen form for captions.
DISPLAY = {"lam-đa": "λ"}

HERE = Path(__file__).parent
BUILD = HERE / "build"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def parse(marked):
    """Strip {cue} markers; return clean text and {cue: char offset of the next word}."""
    cues, out, pos = {}, [], 0
    for m in re.finditer(r"\{(\w+)\}", marked):
        out.append(marked[pos:m.start()])
        cues[m.group(1)] = sum(map(len, out))
        pos = m.end()
    out.append(marked[pos:])
    return "".join(out), cues


async def synth(text, mp3):
    comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH, boundary="WordBoundary")
    words = []
    with open(mp3, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "w": ch["text"]})
    return words


def duration(path):
    err = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


async def main():
    BUILD.mkdir(exist_ok=True)
    t, scenes, all_words = LEAD, [], []
    for sid, marked in SCENES:
        text, cue_chars = parse(marked)
        mp3 = BUILD / f"narr_{sid}.mp3"
        words = await synth(text, mp3)
        # Align TTS tokens to character offsets in the clean text.
        pos = 0
        for w in words:
            i = text.find(w["w"], pos)
            assert i >= 0, (sid, w["w"])
            w["c"], pos = i, i + len(w["w"])
        cues = {}
        for name, c in cue_chars.items():
            w = next(w for w in words if w["c"] >= c)
            cues[name] = round(t + w["t"], 3)
        end = words[-1]["t"] + words[-1]["d"]
        for w in words:
            all_words.append({"scene": sid, "t": round(t + w["t"], 3), "e": round(t + w["t"] + w["d"], 3),
                              "w": DISPLAY.get(w["w"], w["w"]),
                              "brk": text[w["c"] + len(w["w"]):w["c"] + len(w["w"]) + 1] in ".,:?!"})
        scenes.append({"id": sid, "start": round(t, 3), "end": round(t + end, 3), "audio": mp3.name,
                       "audio_len": round(duration(mp3), 3), "cues": cues, "text": text})
        print(f"{sid:7s} {t:6.2f} → {t + end:6.2f}  ({end:5.2f}s, {len(words)} words)")
        t += end + GAP
    total = round(t - GAP + TAIL, 3)
    print(f"total {total:.2f}s")
    (BUILD / "timeline.json").write_text(json.dumps({"total": total, "scenes": scenes, "words": all_words},
                                                    ensure_ascii=False, indent=1), encoding="utf-8")


asyncio.run(main())
