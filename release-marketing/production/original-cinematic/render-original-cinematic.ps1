$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$ffmpeg = 'C:\Users\Home\Documents\Codex\_video-tools2\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe'
$raw = Join-Path $root 'release-marketing\raw\original-cinematic'
$assets = Join-Path $root 'release-marketing\assets\original-cinematic'
$out = Join-Path $root 'release-marketing\renders\original-cinematic'
New-Item -ItemType Directory -Force -Path $assets,$out | Out-Null

function Invoke-Ffmpeg([string[]]$Arguments) {
  & $ffmpeg @Arguments
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
}

$score = Join-Path $assets 'original-cinematic-score.wav'
$scoreFilter = 'aevalsrc=0.045*sin(2*PI*55*t)+0.032*sin(2*PI*110*t)+0.018*sin(2*PI*220*t)+0.014*sin(2*PI*(330+18*sin(2*PI*0.07*t))*t)+0.010*sin(2*PI*440*t):s=48000:d=76'
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-f','lavfi','-i',$scoreFilter,'-t','76','-ac','2','-ar','48000','-c:a','pcm_s16le',$score)

$renders = @(
  @{ input = 'original-cinematic-master-16x9.webm'; output = 'boardstate-lite-original-cinematic-master-16x9.mp4'; duration = '75' },
  @{ input = 'original-cinematic-social-9x16.webm'; output = 'boardstate-lite-original-cinematic-social-9x16.mp4'; duration = '75' },
  @{ input = 'original-cinematic-teaser-15s.webm'; output = 'boardstate-lite-original-cinematic-teaser-15s.mp4'; duration = '15' }
)

foreach ($item in $renders) {
  $input = Join-Path $raw $item.input
  $output = Join-Path $out $item.output
  Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-i',$input,'-i',$score,'-t',$item.duration,'-map','0:v:0','-map','1:a:0','-vf','format=yuv420p','-r','30','-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','192k','-ar','48000','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-movflags','+faststart',$output)
}

$poster = Join-Path $out 'boardstate-lite-original-cinematic-poster.jpg'
Invoke-Ffmpeg @('-hide_banner','-loglevel','error','-y','-ss','70','-i',(Join-Path $out 'boardstate-lite-original-cinematic-master-16x9.mp4'),'-frames:v','1','-q:v','2',$poster)

Write-Output "Rendered original cinematic outputs to $out"
