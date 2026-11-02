#!/bin/sh
# Rebuild the video: narration -> frames -> sound mix -> final MP4.
# PY must have edge-tts, imageio-ffmpeg and numpy; run `npm install` once for @napi-rs/canvas.
set -e
cd "$(dirname "$0")"
PY=${PY:-python3}
FFMPEG=$($PY -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
export FFMPEG

$PY narration.py
node render.mjs
$PY audio.py
"$FFMPEG" -y -v error -i build/video.mp4 -i build/mix.wav -map 0:v -map 1:a -c:v copy \
  -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart \
  llm-cognitive-virus.mp4
echo "wrote llm-cognitive-virus.mp4"
