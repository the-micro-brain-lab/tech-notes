"""Synthesize the music bed and sound effects, then mix them under the narration.

Reads build/timeline.json (scene starts and word cues) and writes build/mix.wav.
Everything is generated here with numpy; nothing is sampled from elsewhere.
"""
import json
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np

SR = 48000
HERE = Path(__file__).parent
BUILD = HERE / "build"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
TL = json.loads((BUILD / "timeline.json").read_text(encoding="utf-8"))
SC = {s["id"]: s for s in TL["scenes"]}
CUE = {k: v for s in TL["scenes"] for k, v in s["cues"].items()}
TOTAL = TL["total"]
N = int(TOTAL * SR) + SR
rng = np.random.default_rng(11)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n, a, r, sus=1.0):
    e = np.full(n, sus)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, sus, na) ** 1.5 if na else e[:na]
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def onepole(x, cutoff):
    """One-pole low-pass, enough for softening noise bursts."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def add(buf, t, sig, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(sig), 0] += sig * gain * l * 1.414
    buf[i:i + len(sig), 1] += sig * gain * r * 1.414


# ---------------- music ----------------
def pad_note(f, dur, a=1.4, r=2.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for ch, det in ((0, -0.0035), (1, 0.0035)):
        s = np.zeros(n)
        for h in range(1, 9):
            amp = 1 / h ** 1.7
            for d in (1 - det, 1 + det):
                s += amp * np.sin(2 * np.pi * f * h * d * t + rng.uniform(0, 6.28))
        # slow breathing tremolo
        s *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.17 * t + ch)
        out[:, ch] = s
    return out * env_adsr(n, a, r)[:, None]


# (start, MIDI notes) — follows the story: calm, building, tense around the flip, lift on recovery, resolve.
A, F, C, G, Dm, E = [57, 64, 67, 71, 72], [53, 60, 64, 69, 72], [48, 55, 64, 67, 74], [43, 55, 62, 67, 71], [50, 57, 65, 69, 72], [52, 59, 64, 68, 71]
Bb = [46, 53, 62, 65, 69]
CHORDS = [
    (0.0, A), (SC["source"]["start"], F), (SC["states"]["start"], C), (SC["states"]["start"] + 3.0, G),
    (SC["forces"]["start"], A), (CUE["kap"], F), (CUE["sq"], Dm), (CUE["weak"] - 0.4, E),
    (SC["demo"]["start"], A), (CUE["cross"], Bb), (CUE["flip"], Dm), (CUE["stay"], Bb), (CUE["below"], E),
    (CUE["recover"], C), (CUE["loop"], G), (CUE["gamma"], A), (CUE["drop"], F),
    (SC["take"]["start"], C), (CUE["f3"], G), (CUE["caveat"], A), (CUE["q"] - 0.2, F), (SC["take"]["end"] + 0.3, C),
]
music = np.zeros((N, 2))
for k, (t0, notes) in enumerate(CHORDS):
    t1 = CHORDS[k + 1][0] if k + 1 < len(CHORDS) else TOTAL + 1.0
    dur = t1 - t0 + 2.0
    for j, m in enumerate(notes):
        add(music, t0, pad_note(midi(m), dur)[:, 0], 0.05 / (1 + 0.15 * j), pan=-0.35 + 0.18 * j)
        add(music, t0, pad_note(midi(m), dur)[:, 1], 0.05 / (1 + 0.15 * j), pan=0.35 - 0.18 * j)
    # sub on the root
    n = int(dur * SR)
    tt = np.arange(n) / SR
    add(music, t0, np.sin(2 * np.pi * midi(notes[0] - 12) * tt) * env_adsr(n, 1.0, 2.0), 0.10)

# Soft plucked arpeggio while the model is being explained; it stops for the flip.
def pluck(f, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t * 6.0) * np.minimum(1, t * 400)

step = 60 / 84 / 2
t = SC["states"]["start"]
k = 0
while t < SC["why"]["end"]:
    if not (CUE["cross"] - 0.2 < t < CUE["stay"]):
        notes = [nt for (t0, nt) in CHORDS if t0 <= t][-1]
        m = notes[[1, 2, 3, 4, 3, 2][k % 6]] + 12
        add(music, t, pluck(midi(m)), 0.035 * (0.8 + 0.2 * (k % 2 == 0)), pan=0.4 * np.sin(k * 0.9))
    t += step
    k += 1

# ---------------- sound effects ----------------
sfx = np.zeros((N, 2))


def tone(f0, f1, dur, decay, kind="sine"):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = np.geomspace(f0, f1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) if kind == "sine" else np.sin(ph) + 0.3 * np.sin(2 * ph)
    return s * np.exp(-tt * decay) * np.minimum(1, tt * 300)


def noise_swell(dur, cutoff, peak=0.7):
    n = int(dur * SR)
    x = onepole(rng.standard_normal(n), cutoff)
    shape = np.sin(np.pi * np.clip(np.arange(n) / n / peak, 0, 1) * 0.5) * np.clip((n - np.arange(n)) / (n * (1 - peak)), 0, 1)
    return x * shape / (np.abs(x).max() + 1e-9)


def bell(f, dur=3.5):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * r * tt) * np.exp(-tt * d) for r, a, d in [(1, 1, 1.2), (2.76, 0.45, 2.2), (5.4, 0.25, 3.5), (8.9, 0.1, 5)])
    return s * np.minimum(1, tt * 500)


add(sfx, 0.0, noise_swell(1.6, 900, 0.8), 0.10)
add(sfx, CUE["ai"], tone(1320, 660, 0.7, 5), 0.12)
# contagion: tiny blips scattered while the front spreads
for _ in range(70):
    tt = CUE["spread"] + 2.4 * rng.random() ** 0.8
    add(sfx, tt, tone(rng.uniform(1500, 2600), rng.uniform(900, 1400), 0.12, 30), 0.025, pan=rng.uniform(-0.8, 0.8))
add(sfx, CUE["title"], tone(110, 55, 1.6, 2.2), 0.22)
add(sfx, SC["source"]["start"] - 0.2, noise_swell(0.7, 2500, 0.5), 0.10, pan=-0.2)
for cue, m in (("U", 69), ("C", 72), ("D", 76)):
    add(sfx, CUE[cue], pluck(midi(m), 1.2), 0.10)
for cue in ("lam", "kap"):
    add(sfx, CUE[cue] - 0.15, noise_swell(0.6, 1800, 0.6), 0.07)


# slider ticks: one per 0.01 of λ, from the same schedule the video uses
def smooth(x):
    x = min(1, max(0, x))
    return x * x * (3 - 2 * x)


def lam_at(t):
    ramp = lambda a, b, t0, t1: a + (b - a) * smooth((t - t0) / (t1 - t0))
    if t < CUE["cross"]:
        return ramp(0.30, 0.45, CUE["up"], CUE["at45"] - 0.1)
    if t < CUE["down"]:
        return ramp(0.45, 0.60, CUE["cross"] + 0.1, CUE["cross"] + 0.9)
    if t < CUE["below"]:
        return ramp(0.60, 0.45, CUE["down"], CUE["down"] + 0.8)
    return ramp(0.45, 0.30, CUE["below"], CUE["below"] + 0.7)


prev = round(lam_at(SC["demo"]["start"]) * 100)
for i in range(int((SC["why"]["start"] - SC["demo"]["start"]) * 600)):
    tt = SC["demo"]["start"] + i / 600
    cur = round(lam_at(tt) * 100)
    if cur != prev:
        add(sfx, tt, tone(2400 + 40 * (cur - 30), 2000, 0.03, 120), 0.05)
        prev = cur
# the flip: riser, then a deep hit
rise = noise_swell(CUE["flip"] - CUE["cross"], 3000, 0.97) * np.linspace(0.2, 1, int((CUE["flip"] - CUE["cross"]) * SR))
add(sfx, CUE["cross"], rise, 0.08)
add(sfx, CUE["flip"] - 0.05, tone(70, 30, 2.4, 1.6), 0.55)
add(sfx, CUE["flip"] - 0.05, noise_swell(1.2, 400, 0.05), 0.25)
add(sfx, CUE["recover"], tone(midi(72), midi(72), 1.5, 3), 0.08, pan=-0.3)
add(sfx, CUE["recover"] + 0.18, tone(midi(79), midi(79), 1.8, 2.5), 0.08, pan=0.3)
add(sfx, CUE["loop"] - 0.1, noise_swell(0.9, 1500, 0.5), 0.06)
add(sfx, CUE["drop"], tone(700, 260, 1.0, 3), 0.07)
for cue in ("f1", "f2", "f3"):
    add(sfx, CUE[cue] - 0.1, tone(1150, 900, 0.18, 22) + 0.3 * onepole(rng.standard_normal(int(0.18 * SR)), 3000) * np.exp(-np.arange(int(0.18 * SR)) / SR * 60), 0.10)
add(sfx, CUE["q"] - 0.25, bell(midi(72)), 0.10, pan=-0.15)
add(sfx, CUE["q"] - 0.25, bell(midi(79)), 0.05, pan=0.2)

# ---------------- reverb (convolution with a synthetic hall) ----------------
def reverb(x, secs=2.8, wet=0.32):
    n = int(secs * SR)
    tt = np.arange(n) / SR
    out = np.empty_like(x)
    L = 1 << int(np.ceil(np.log2(len(x) + n)))
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-tt * 6.9 / secs)
        ir = np.convolve(ir, np.ones(24) / 24, mode="same")  # darker tail
        ir /= np.sqrt((ir ** 2).sum())
        y = np.fft.irfft(np.fft.rfft(x[:, ch], L) * np.fft.rfft(ir, L), L)[: len(x)]
        out[:, ch] = (1 - wet) * x[:, ch] + wet * y
    return out


music = reverb(music, 3.2, 0.45)
sfx = reverb(sfx, 2.2, 0.25)

# ---------------- narration ----------------
voice = np.zeros((N, 2))
for s in TL["scenes"]:
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(BUILD / s["audio"]),
                          "-af", "highpass=f=70,equalizer=f=150:t=q:w=1:g=2.5,equalizer=f=3200:t=q:w=1.4:g=1.2",
                          "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    v = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    add(voice, s["start"], v, 1.0)
voice = 0.9 * voice + 0.1 * reverb(voice, 1.2, 1.0)  # a touch of room

# Duck the music under the voice.
envl = np.abs(voice[:, 0])
win = int(0.25 * SR)
envl = np.convolve(envl, np.ones(win) / win, mode="same")
envl = np.clip(envl / (np.percentile(envl[envl > 1e-4], 90) + 1e-9), 0, 1)
duck = 1 - 0.55 * envl
music *= duck[:, None]

# Fade the music in and out, mix, and write.
fade = np.ones(N)
fi, fo = int(1.2 * SR), int(2.5 * SR)
fade[:fi] = np.linspace(0, 1, fi)
end = int(TOTAL * SR)
fade[end - fo:end] = np.linspace(1, 0, fo)
fade[end:] = 0
rms = lambda x: 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)
# Fixed balance: music 14 dB under the voice, effects peaking at 60% of the voice peak.
music *= fade[:, None]
music *= 10 ** ((rms(voice[:end]) - 14 - rms(music[:end])) / 20)
sfx *= fade[:, None] ** 0.3
sfx *= 0.6 * np.abs(voice).max() / (np.abs(sfx).max() + 1e-9)
mix = (voice + music + sfx)[:end]
peak = np.abs(mix).max()
mix = mix / peak * 0.89
with wave.open(str(BUILD / "mix.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"wrote build/mix.wav  {len(mix) / SR:.2f}s  voice {rms(voice[:end]):.1f} dB  music {rms(music[:end]):.1f} dB  sfx {rms(sfx[:end]):.1f} dB")
