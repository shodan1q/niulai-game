#!/bin/bash
# 用麦克风录一段自己的声音，放进游戏语音槽（零版权风险路线）
# 用法: ./record-voice.sh <角色id> [秒数]     例: ./record-voice.sh niulai 3
# 录完后在 game/public/voice/manifest.json 里登记 "id": "id.mp3" 即生效
set -e
id="$1"; dur="${2:-3}"
if [ -z "$id" ]; then
  echo "用法: $0 <角色id> [秒数]"; echo "可用 id: niulai niuer mother father baola dog wolf snake lark"
  echo "查看可用录音设备: ffmpeg -f avfoundation -list_devices true -i \"\""
  exit 1
fi
out="$(cd "$(dirname "$0")" && pwd)/../game/public/voice/$id.mp3"
echo "🎙  开始录音 ${dur}s（对着麦克风吹/喊/学牛叫都行）…"
ffmpeg -y -v error -f avfoundation -i ":0" -t "$dur" \
  -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ac 1 -c:a libmp3lame -q:a 4 "$out"
echo "✅ 已保存 $out"
echo "   在 game/public/voice/manifest.json 登记 \"$id\": \"$id.mp3\" 后重新构建即可在游戏里听到"
