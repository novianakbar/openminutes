#!/bin/bash
set -e

Xvfb :99 -screen 0 1280x720x24 &

# Live view dashboard (docs/live-view-design.md): export display :99 sebagai
# server RFB. -forever: tetap hidup setelah viewer putus; -shared: multi-viewer.
# Keamanan di layer API (view-token) + port host hanya di-bind 127.0.0.1.
# Retry menunggu Xvfb siap; kalau tetap gagal, bot jalan terus tanpa live view.
for _ in $(seq 1 10); do
  if x11vnc -display :99 -rfbport 5900 -forever -shared -nopw -quiet -bg -noxdamage 2>/dev/null; then
    break
  fi
  sleep 0.5
done

pulseaudio -D --exit-idle-time=-1
pactl load-module module-null-sink sink_name=MeetSink sink_properties=device.description=MeetSink
pactl set-default-sink MeetSink
# Zoom lebih sensitif terhadap device palsu bawaan Chromium. Sediakan input
# PulseAudio hening sebagai microphone normal agar Zoom tidak perlu
# --use-fake-device-for-media-stream.
pactl load-module module-null-source source_name=SilentMic source_properties=device.description=SilentMic >/dev/null 2>&1 || true
pactl set-default-source SilentMic >/dev/null 2>&1 || true

exec node dist/index.js
