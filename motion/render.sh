#!/usr/bin/env bash
# render.sh -- renders the pieces, both themes, and encodes the web files into
# ../images/motion/. Usage: bash render.sh [piece ...]   (default: all of them)
# Needs Node 22+ and FFmpeg. HF=path/to/hyperframes overrides the npx default. See README.md.
set -euo pipefail
cd "$(dirname "$0")"
export HYPERFRAMES_NO_TELEMETRY=1
read -ra HF <<< "${HF:-npx --yes hyperframes@0.8.163}"   # constraint: an HF path must not contain spaces
OUT=../images/motion
PIECES=("${@:-screen-to-rail knots-to-curve any-app stroke timing}")
mkdir -p assets renders "$OUT"
cp ../fonts/Archivo.woff2 ../fonts/MartianMono.woff2 ../images/phosphor/dash-dark.webp ../images/phosphor/dash-light.webp assets/

TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
for piece in ${PIECES[@]}; do
  for theme in dark light; do
    name="$piece-$theme" frames="renders/$piece-$theme"
    rm -rf "$frames"
    "${HF[@]}" render . --composition "$piece.html" --variables "{\"theme\":\"$theme\"}" --format png-sequence --output "$frames" --quiet
    crf=31 mcrf=21   # the 70 s and 24 s pieces: their 1280 files under 2 MB
    [ "$piece" = knots-to-curve ] && crf=35
    [ "$piece" = timing ] && crf=37 mcrf=25
    for w in 1280 640; do
      sfx=$([ $w = 1280 ] && echo "" || echo "-$w")
      vf="scale=$w:-2:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p"
      in=(-y -v error -framerate 30 -i "$frames/frame_%06d.png" -vf "$vf" -an "${TAGS[@]}")
      # one keyframe per loop: the clips are short and only ever loop from the start
      ffmpeg "${in[@]}" -c:v libvpx-vp9 -b:v 0 -crf $crf -row-mt 1 -deadline good -cpu-used 1 -g 400 "$OUT/$name$sfx.webm"
      ffmpeg "${in[@]}" -c:v libx264 -profile:v high -crf $mcrf -preset veryslow -tune animation -g 400 -movflags +faststart "$OUT/$name$sfx.mp4"
    done
    ffmpeg -y -v error -i "$frames/frame_000001.png" -c:v libwebp -quality 80 "$OUT/$name.webp"
  done
done
ls -l "$OUT"
