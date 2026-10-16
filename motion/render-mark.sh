#!/usr/bin/env bash
# render-mark.sh -- renders the animated mark (mark.html: orbit and phosphor) and encodes the social
# and README files into $OUT (default renders/mark/; generated media, never committed): MP4 and WebM
# on dark and on light at 1920x1080 and 1080x1080, a VP9 WebM with alpha, and a GIF under 2 MB.
# Usage: bash render-mark.sh [piece ...]   (default: both)
# Needs Node 22+ and FFmpeg. HF=path/to/hyperframes overrides the npx default. See README.md.
# Constraint: HyperFrames writes the PNG frames with a transparent background, so the backgrounds are
# laid under them here. Phosphor draws differently on light (no added light), so it renders twice.
set -euo pipefail
cd "$(dirname "$0")"
export HYPERFRAMES_NO_TELEMETRY=1
read -ra HF <<< "${HF:-npx --yes hyperframes@0.8.163}"   # constraint: an HF path must not contain spaces
OUT=${OUT:-renders/mark}
PIECES=("${@:-orbit phosphor}")
mkdir -p assets "$OUT"
cp ../mark-anim.js assets/

declare -A BG=([dark]=0x0B0B0C [light]=0xF3F2EE)
TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
for piece in ${PIECES[@]}; do
  themes=(dark); [ $piece = phosphor ] && themes=(dark light)
  for theme in ${themes[@]}; do
    rm -rf "renders/mark-$piece-$theme"
    "${HF[@]}" render . --composition mark.html --variables "{\"piece\":\"$piece\",\"theme\":\"$theme\"}" --format png-sequence --output "renders/mark-$piece-$theme" --quiet
  done
  # the glow moves across the whole frame every frame: phosphor takes a higher CRF to stay social-sized
  crf=18 vcrf=30; [ $piece = phosphor ] && crf=23 vcrf=36
  for bg in dark light; do
    frames="renders/mark-$piece-$([ $piece = phosphor ] && echo $bg || echo dark)"
    for cut in 1920x1080 1080x1080; do
      crop=$([ $cut = 1080x1080 ] && echo "crop=1080:1080:420:0," || echo "")
      in=(-y -v error -f lavfi -i "color=c=${BG[$bg]}:s=1920x1080:r=60" -framerate 60 -i "$frames/frame_%06d.png" -an)
      vf="[0][1]overlay=shortest=1,${crop}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
      # one keyframe per loop: the clips only ever loop from the start
      ffmpeg "${in[@]}" -filter_complex "$vf" "${TAGS[@]}" -c:v libvpx-vp9 -b:v 0 -crf $vcrf -row-mt 1 -deadline good -cpu-used 1 -g 600 "$OUT/$piece-$bg-$cut.webm"
      ffmpeg "${in[@]}" -filter_complex "$vf" "${TAGS[@]}" -c:v libx264 -profile:v high -crf $crf -preset veryslow -tune animation -g 600 -movflags +faststart "$OUT/$piece-$bg-$cut.mp4"
    done
  done
  # alpha: the dark drawing (phosphor's light adds up on a dark page), square and wide
  # The frames' color under clear pixels is noise the encoder pays for: rebuilt from the color over black.
  for cut in 1920x1080 1080x1080; do
    crop=$([ $cut = 1080x1080 ] && echo "crop=1080:1080:420:0," || echo "null,")
    ffmpeg -y -v error -f lavfi -i "color=c=black:s=$cut:r=60" -framerate 60 -i "renders/mark-$piece-dark/frame_%06d.png" -an \
      -filter_complex "[1]${crop}split[a][b];[0][a]overlay=shortest=1[pm];[b]alphaextract[al];[pm][al]alphamerge,unpremultiply=inplace=1,format=yuva420p" \
      -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf $vcrf -row-mt 1 -deadline good -cpu-used 1 -g 600 "$OUT/$piece-alpha-$cut.webm"
  done
  # Discord and READMEs: a whole loop on dark, 360 square at 25 fps, one palette, under 2 MB. The
  # phosphor's glow changes every pixel every frame: its GIF is a one-turn loop (3.2 s), rendered apart.
  gframes="renders/mark-$piece-dark" gd=9.6
  if [ $piece = phosphor ]; then
    gframes=renders/mark-phosphor-gif gd=3.2
    rm -rf "$gframes"
    "${HF[@]}" render . --composition mark.html --variables '{"piece":"phosphor","theme":"dark","turns":1}' --format png-sequence --output "$gframes" --quiet
  fi
  ffmpeg -y -v error -f lavfi -i "color=c=${BG[dark]}:s=1920x1080:r=60" -framerate 60 -i "$gframes/frame_%06d.png" \
    -filter_complex "[0][1]overlay=shortest=1,crop=1080:1080:420:0,trim=duration=$gd,fps=25,scale=360:360:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" -loop 0 "$OUT/$piece-dark.gif"
done
ls -l "$OUT"
