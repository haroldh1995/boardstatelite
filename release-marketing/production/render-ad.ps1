$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$raw = Get-ChildItem (Join-Path $root "release-marketing\raw") -Filter "*.webm" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $raw) { throw "No raw evidence recording found." }
$ffmpeg = if ($env:FFMPEG) { $env:FFMPEG } elseif (Test-Path (Join-Path $root "node_modules\ffmpeg-win32.exe")) { Join-Path $root "node_modules\ffmpeg-win32.exe" } else { "ffmpeg" }
$renders = Join-Path $root "release-marketing\renders"
New-Item -ItemType Directory -Force $renders | Out-Null
$audio = Join-Path $root "release-marketing\narration.wav"
$font = "C:/Windows/Fonts/segoeui.ttf"
$fontBold = "C:/Windows/Fonts/seguisb.ttf"
$master = Join-Path $renders "boardstate-lite-master-16x9.mp4"
$vertical = Join-Path $renders "boardstate-lite-social-9x16.mp4"
$teaser = Join-Path $renders "boardstate-lite-teaser-15s.mp4"
$common = "drawtext=fontfile='$fontBold':text='BOARDSTATE LITE':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=90:enable='between(t,0,6)',drawtext=fontfile='$font':text='YOUR GAME IS COMPLEX.':fontcolor=0xd9e4ff:fontsize=42:x=(w-text_w)/2:y=170:enable='between(t,0,6)',drawtext=fontfile='$font':text='YOUR COMPANION SHOULD NOT BE.':fontcolor=0xcab978:fontsize=34:x=(w-text_w)/2:y=225:enable='between(t,0,6)',drawtext=fontfile='$fontBold':text='TRACK THE BATTLEFIELD.':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=905:enable='between(t,15,27)',drawtext=fontfile='$fontBold':text='AUTOMATIC WHEN IT CAN.':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=880:enable='between(t,27,43)',drawtext=fontfile='$font':text='PLAYER-CONTROLLED WHEN IT COUNTS.':fontcolor=0xcab978:fontsize=32:x=(w-text_w)/2:y=940:enable='between(t,27,43)',drawtext=fontfile='$fontBold':text='LESS BOOKKEEPING. MORE MAGIC.':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=930:enable='between(t,57,70)',drawtext=fontfile='$font':text='TRY BOARDSTATE LITE':fontcolor=0xcab978:fontsize=36:x=(w-text_w)/2:y=990:enable='between(t,57,70)'"
$filter = "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24:10,eq=brightness=-0.32:saturation=0.55[bg];[0:v]scale=440:1080:force_original_aspect_ratio=decrease:flags=lanczos[phone];[bg][phone]overlay=(W-w)/2:(H-h)/2:enable='between(t,0,70)',${common}"
$masterArgs = @("-y", "-stream_loop", "4", "-i", $raw.FullName, "-i", $audio, "-t", "70", "-filter_complex", $filter, "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-af", "apad", $master)
& $ffmpeg @masterArgs
$verticalFilter = "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x050815,${common}"
$verticalArgs = @("-y", "-stream_loop", "4", "-i", $raw.FullName, "-i", $audio, "-t", "70", "-filter_complex", $verticalFilter, "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-af", "apad", $vertical)
& $ffmpeg @verticalArgs
$teaserArgs = @("-y", "-i", $master, "-t", "15", "-c", "copy", $teaser)
& $ffmpeg @teaserArgs
& $ffmpeg -y -ss 00:00:10 -i $master -frames:v 1 -q:v 2 (Join-Path $renders "boardstate-lite-thumbnail.jpg")
Write-Output $master
Write-Output $vertical
Write-Output $teaser
