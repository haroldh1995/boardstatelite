param(
    [string]$Ffmpeg = $env:FFMPEG
)
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $Ffmpeg) {
    $candidate = Join-Path $root "node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe"
    if (Test-Path $candidate) { $Ffmpeg = $candidate }
}
if (-not $Ffmpeg) { throw "Set FFMPEG to a working ffmpeg executable." }

$rawCore = Join-Path $root "release-marketing\raw\verified-marketing\core-feature-pass.webm"
$rawDungeon = Join-Path $root "release-marketing\raw\verified-marketing\dungeon-initiative-pass.webm"
$fieldStill = Join-Path $root "release-marketing\evidence\verified-marketing\core-01-field.png"
$abilityStill = Join-Path $root "release-marketing\evidence\verified-marketing\core-05-ability-focus.png"
$abilityDetailStill = Join-Path $root "release-marketing\evidence\verified-marketing\core-06-ability-inspection.png"
$undoStill = Join-Path $root "release-marketing\evidence\verified-marketing\core-08-undo.png"
$outRoot = Join-Path $root "release-marketing\renders\final-revision"
$tmp = Join-Path $root "release-marketing\.final-ad-tmp"
$font = "C:/Windows/Fonts/segoeui.ttf"
$fontBold = "C:/Windows/Fonts/seguisb.ttf"

foreach ($required in @($rawCore, $rawDungeon, $fieldStill, $abilityStill, $abilityDetailStill, $undoStill)) {
    if (-not (Test-Path $required)) { throw "Missing verified raw evidence: $required" }
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp, $outRoot | Out-Null

function Invoke-Ffmpeg {
    param([string[]]$FfmpegArgs)
    & $Ffmpeg @FfmpegArgs
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
}

function New-TitleCard {
    param([string]$Name, [double]$Duration, [string]$Headline, [string]$Subline)
    $out = Join-Path $tmp "$Name.mp4"
    $fadeOut = [math]::Max(0.7, $Duration - 0.75)
    $filter = "drawbox=x=0:y=0:w=iw:h=ih:color=0x050815:t=fill,drawbox=x=150:y=220:w=1620:h=2:color=0xcab978@0.55:t=fill,drawbox=x=150:y=860:w=1620:h=2:color=0x6d5bd0@0.45:t=fill,drawtext=fontfile='$fontBold':text='BOARDSTATE LITE':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=300,drawtext=fontfile='$fontBold':text='$Headline':fontcolor=white:fontsize=68:x=(w-text_w)/2:y=475,drawtext=fontfile='$font':text='$Subline':fontcolor=0xcab978:fontsize=30:x=(w-text_w)/2:y=585,fade=t=in:st=0:d=0.55,fade=t=out:st=${fadeOut}:d=0.75"
    Invoke-Ffmpeg @("-loglevel","error","-y","-f","lavfi","-i","color=c=0x050815:s=1920x1080:r=30:d=$Duration","-vf",$filter,"-r","30","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-an",$out)
    return $out
}

function New-PhoneShot {
    param(
        [string]$Name,
        [string]$Source,
        [double]$Start,
        [double]$SourceDuration,
        [double]$SlowFactor,
        [string]$Headline,
        [string]$Subline,
        [int]$CropWidth = 0
    )
    $out = Join-Path $tmp "$Name.mp4"
    $duration = $SourceDuration * $SlowFactor
    $fadeOut = [math]::Max(0.7, $duration - 0.75)
    $mult = $SlowFactor.ToString([cultureinfo]::InvariantCulture)
    $headlineEsc = $Headline.Replace("'", "\\'")
    $sublineEsc = $Subline.Replace("'", "\\'")
    $input = if ($CropWidth -gt 0) { "[0:v]crop=${CropWidth}:ih:0:0,setpts=${mult}*(PTS-STARTPTS)" } else { "[0:v]setpts=${mult}*(PTS-STARTPTS)" }
    $phoneWidth = if ($CropWidth -gt 0) { 420 } else { 520 }
    $phonePad = if ($CropWidth -gt 0) { 456 } else { 556 }
    $filter = "${input},split=2[bg0][phone0];[bg0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:14,eq=brightness=-0.40:saturation=0.55[bg];[phone0]scale=${phoneWidth}:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=${phonePad}:1080:(ow-iw)/2:(oh-ih)/2:color=0x03040b,drawbox=x=0:y=0:w=iw:h=ih:color=0xcab978@0.48:t=2[phone];[bg][phone]overlay=(W-w)/2:(H-h)/2,drawtext=fontfile='$fontBold':text='$headlineEsc':fontcolor=white:fontsize=42:x=110:y=845:box=1:boxcolor=0x050815@0.78:boxborderw=18,drawtext=fontfile='$font':text='$sublineEsc':fontcolor=0xcab978:fontsize=25:x=112:y=910:box=1:boxcolor=0x050815@0.66:boxborderw=12,fade=t=in:st=0:d=0.55,fade=t=out:st=${fadeOut}:d=0.75"
    Invoke-Ffmpeg @("-loglevel","error","-y","-ss",$Start,"-t",$SourceDuration,"-i",$Source,"-filter_complex",$filter,"-t",$duration,"-r","30","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-an",$out)
    return $out
}

function New-VerticalTitleCard {
    param([string]$Name, [double]$Duration, [string]$Headline, [string]$Subline)
    $out = Join-Path $tmp "$Name.mp4"
    $fadeOut = [math]::Max(0.7, $Duration - 0.75)
    $filter = "drawbox=x=0:y=0:w=iw:h=ih:color=0x050815:t=fill,drawbox=x=70:y=500:w=940:h=2:color=0xcab978@0.55:t=fill,drawbox=x=70:y=1415:w=940:h=2:color=0x6d5bd0@0.45:t=fill,drawtext=fontfile='$fontBold':text='BOARDSTATE LITE':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=610,drawtext=fontfile='$fontBold':text='$Headline':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=820,drawtext=fontfile='$font':text='$Subline':fontcolor=0xcab978:fontsize=28:x=(w-text_w)/2:y=975,fade=t=in:st=0:d=0.55,fade=t=out:st=${fadeOut}:d=0.75"
    Invoke-Ffmpeg @("-loglevel","error","-y","-f","lavfi","-i","color=c=0x050815:s=1080x1920:r=30:d=$Duration","-vf",$filter,"-r","30","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-an",$out)
    return $out
}

function New-VerticalPhoneShot {
    param(
        [string]$Name,
        [string]$Source,
        [double]$Start,
        [double]$SourceDuration,
        [double]$SlowFactor,
        [string]$Headline,
        [string]$Subline,
        [int]$CropWidth = 0
    )
    $out = Join-Path $tmp "$Name.mp4"
    $duration = $SourceDuration * $SlowFactor
    $fadeOut = [math]::Max(0.7, $duration - 0.75)
    $mult = $SlowFactor.ToString([cultureinfo]::InvariantCulture)
    $headlineEsc = $Headline.Replace("'", "\\'")
    $sublineEsc = $Subline.Replace("'", "\\'")
    $input = if ($CropWidth -gt 0) { "[0:v]crop=${CropWidth}:ih:0:0,setpts=${mult}*(PTS-STARTPTS)" } else { "[0:v]setpts=${mult}*(PTS-STARTPTS)" }
    $phoneWidth = if ($CropWidth -gt 0) { 720 } else { 820 }
    $phonePad = if ($CropWidth -gt 0) { 780 } else { 880 }
    $filter = "${input},split=2[bg0][phone0];[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:14,eq=brightness=-0.42:saturation=0.52[bg];[phone0]scale=${phoneWidth}:1720:force_original_aspect_ratio=decrease:flags=lanczos,pad=${phonePad}:1740:(ow-iw)/2:(oh-ih)/2:color=0x03040b,drawbox=x=0:y=0:w=iw:h=ih:color=0xcab978@0.48:t=2[phone];[bg][phone]overlay=(W-w)/2:(H-h)/2,drawtext=fontfile='$fontBold':text='$headlineEsc':fontcolor=white:fontsize=38:x=70:y=1780:box=1:boxcolor=0x050815@0.86:boxborderw=14,drawtext=fontfile='$font':text='$sublineEsc':fontcolor=0xcab978:fontsize=23:x=72:y=1830:box=1:boxcolor=0x050815@0.72:boxborderw=9,fade=t=in:st=0:d=0.55,fade=t=out:st=${fadeOut}:d=0.75"
    Invoke-Ffmpeg @("-loglevel","error","-y","-ss",$Start,"-t",$SourceDuration,"-i",$Source,"-filter_complex",$filter,"-t",$duration,"-r","30","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-an",$out)
    return $out
}

function New-PhoneStill {
    param([string]$Name, [string]$Image, [double]$Duration, [string]$Headline, [string]$Subline)
    $out = Join-Path $tmp "$Name.mp4"
    $fadeOut = [math]::Max(0.7, $Duration - 0.75)
    $headlineEsc = $Headline.Replace("'", "\\'")
    $sublineEsc = $Subline.Replace("'", "\\'")
    $filter = "[0:v]split=2[bg0][phone0];[bg0]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:14,eq=brightness=-0.40:saturation=0.55[bg];[phone0]scale=520:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=556:1080:(ow-iw)/2:(oh-ih)/2:color=0x03040b,drawbox=x=0:y=0:w=iw:h=ih:color=0xcab978@0.48:t=2[phone];[bg][phone]overlay=(W-w)/2:(H-h)/2,drawtext=fontfile='$fontBold':text='$headlineEsc':fontcolor=white:fontsize=42:x=110:y=845:box=1:boxcolor=0x050815@0.78:boxborderw=18,drawtext=fontfile='$font':text='$sublineEsc':fontcolor=0xcab978:fontsize=25:x=112:y=910:box=1:boxcolor=0x050815@0.66:boxborderw=12,fade=t=in:st=0:d=0.55,fade=t=out:st=${fadeOut}:d=0.75"
    Invoke-Ffmpeg @("-loglevel","error","-y","-loop","1","-i",$Image,"-vf",$filter,"-t",$Duration,"-r","30","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-an",$out)
    return $out
}

function New-VerticalStill {
    param([string]$Name, [string]$Image, [double]$Duration, [string]$Headline, [string]$Subline)
    $out = Join-Path $tmp "$Name.mp4"
    $fadeOut = [math]::Max(0.7, $Duration - 0.75)
    $headlineEsc = $Headline.Replace("'", "\\'")
    $sublineEsc = $Subline.Replace("'", "\\'")
    $filter = "[0:v]split=2[bg0][phone0];[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:14,eq=brightness=-0.42:saturation=0.52[bg];[phone0]scale=820:1720:force_original_aspect_ratio=decrease:flags=lanczos,pad=880:1740:(ow-iw)/2:(oh-ih)/2:color=0x03040b,drawbox=x=0:y=0:w=iw:h=ih:color=0xcab978@0.48:t=2[phone];[bg][phone]overlay=(W-w)/2:(H-h)/2,drawtext=fontfile='$fontBold':text='$headlineEsc':fontcolor=white:fontsize=38:x=70:y=1780:box=1:boxcolor=0x050815@0.86:boxborderw=14,drawtext=fontfile='$font':text='$sublineEsc':fontcolor=0xcab978:fontsize=23:x=72:y=1830:box=1:boxcolor=0x050815@0.72:boxborderw=9,fade=t=in:st=0:d=0.55,fade=t=out:st=${fadeOut}:d=0.75"
    Invoke-Ffmpeg @("-loglevel","error","-y","-loop","1","-i",$Image,"-vf",$filter,"-t",$Duration,"-r","30","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-an",$out)
    return $out
}

$segments = @()
$segments += New-PhoneShot "01-hook" $rawCore 1.1 4.285714 1.4 "COMMANDER IS COMPLEX." "TRACKING IT DOES NOT HAVE TO BE."
$segments += New-TitleCard "02-intro" 3 "YOUR INTELLIGENT COMPANION" "Built for physical Commander."
$segments += New-PhoneShot "03-life" $rawCore 2.4 4 1.75 "LIFE, WITHOUT FRICTION" "Adjust fast. See every change."
$segments += New-PhoneShot "04-full-life" $rawCore 3.1 3.333333 1.5 "FULL-SCREEN LIFE" "Keep the game in view."
$segments += New-PhoneStill "05-counters-before" $fieldStill 5 "AUTOMATIC COUNTER TRACKING" "Before the effect."
$segments += New-PhoneStill "05-counters-after" $undoStill 7 "COUNTERS UPDATED" "Deterministic effects, handled cleanly."
$segments += New-TitleCard "06-choice" 3 "PLAYER-CONTROLLED CHOICES" "Lite assists. You decide."
$segments += New-PhoneStill "07-ability-focus" $abilityStill 5 "ABILITY FOCUS" "See available abilities. Remember your activations."
$segments += New-PhoneStill "07b-ability-detail" $abilityDetailStill 5 "ABILITY DETAILS" "Read the actual ability before you activate it."
$segments += New-PhoneStill "08-undo" $undoStill 7 "CORRECTIONS IN SECONDS" "Review the action. Keep playing."
$segments += New-PhoneShot "09-dungeon" $rawDungeon 1.4 3.6 2.5 "DUNGEONS & INITIATIVE" "Progress, ownership, and context in one place."
$segments += New-TitleCard "10-close" 13 "PLAY THE CARDS." "LET LITE HANDLE THE BOOKKEEPING."

$list = Join-Path $tmp "concat.txt"
[System.IO.File]::WriteAllLines($list, @($segments | ForEach-Object { "file '$($_.Replace('\','/'))'" }), (New-Object System.Text.UTF8Encoding($false)))
$videoOnly = Join-Path $tmp "master-video.mp4"
Invoke-Ffmpeg @("-loglevel","error","-y","-f","concat","-safe","0","-i",$list,"-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-r","30","-an",$videoOnly)

$score = Join-Path $tmp "original-score.wav"
$scoreExpression = "0.085*sin(2*PI*(55+4*sin(2*PI*t/11))*t)+0.032*sin(2*PI*110*t)+0.014*sin(2*PI*220*t)+0.008*sin(2*PI*330*t)"
Invoke-Ffmpeg @("-loglevel","error","-y","-f","lavfi","-i","aevalsrc=$scoreExpression`:s=48000:d=75","-ac","2","-af","afade=t=in:st=0:d=2,afade=t=out:st=71:d=4,volume=0.48","$score")

$master = Join-Path $outRoot "boardstate-lite-cinematic-master-16x9-revision-02-review-cut.mp4"
Invoke-Ffmpeg @("-loglevel","error","-y","-i",$videoOnly,"-i",$score,"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-shortest",$master)

# The vertical edit is composed from the same original portrait captures, not cropped from the landscape master.
$verticalOnly = Join-Path $tmp "vertical-video.mp4"
$vSegments = @()
$vSegments += New-VerticalPhoneShot "v01-hook" $rawCore 1.1 4.285714 1.4 "COMMANDER IS COMPLEX." "TRACKING IT DOES NOT HAVE TO BE."
$vSegments += New-VerticalTitleCard "v02-intro" 3 "YOUR INTELLIGENT COMPANION" "Built for physical Commander."
$vSegments += New-VerticalPhoneShot "v03-life" $rawCore 2.4 4 1.75 "LIFE, WITHOUT FRICTION" "Adjust fast. See every change."
$vSegments += New-VerticalPhoneShot "v04-full-life" $rawCore 3.1 3.333333 1.5 "FULL-SCREEN LIFE" "Keep the game in view."
$vSegments += New-VerticalStill "v05-counters-before" $fieldStill 5 "AUTOMATIC COUNTER TRACKING" "Before the effect."
$vSegments += New-VerticalStill "v05-counters-after" $undoStill 7 "COUNTERS UPDATED" "Deterministic effects, handled cleanly."
$vSegments += New-VerticalTitleCard "v06-choice" 3 "PLAYER-CONTROLLED CHOICES" "Lite assists. You decide."
$vSegments += New-VerticalStill "v07-ability-focus" $abilityStill 5 "ABILITY FOCUS" "See available abilities. Remember your activations."
$vSegments += New-VerticalStill "v07b-ability-detail" $abilityDetailStill 5 "ABILITY DETAILS" "Read the actual ability before you activate it."
$vSegments += New-VerticalStill "v08-undo" $undoStill 7 "CORRECTIONS IN SECONDS" "Review the action. Keep playing."
$vSegments += New-VerticalPhoneShot "v09-dungeon" $rawDungeon 1.4 3.6 2.5 "DUNGEONS & INITIATIVE" "Progress, ownership, and context in one place."
$vSegments += New-VerticalTitleCard "v10-close" 13 "PLAY THE CARDS." "LET LITE HANDLE THE BOOKKEEPING."

$vList = Join-Path $tmp "vertical-concat.txt"
[System.IO.File]::WriteAllLines($vList, @($vSegments | ForEach-Object { "file '$($_.Replace('\','/'))'" }), (New-Object System.Text.UTF8Encoding($false)))
Invoke-Ffmpeg @("-loglevel","error","-y","-f","concat","-safe","0","-i",$vList,"-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-r","30","-an",$verticalOnly)
$vertical = Join-Path $outRoot "boardstate-lite-cinematic-social-9x16-revision-02-review-cut.mp4"
Invoke-Ffmpeg @("-loglevel","error","-y","-i",$verticalOnly,"-i",$score,"-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-shortest",$vertical)

$teaser = Join-Path $outRoot "boardstate-lite-cinematic-teaser-15s-revision-02-review-cut.mp4"
Invoke-Ffmpeg @("-loglevel","error","-y","-ss","0","-t","15","-i",$vertical,"-c","copy",$teaser)
$poster = Join-Path $outRoot "boardstate-lite-cinematic-poster-revision-02.jpg"
Invoke-Ffmpeg @("-loglevel","error","-y","-ss","65","-i",$master,"-frames:v","1","-q:v","2",$poster)

Write-Output $master
Write-Output $vertical
Write-Output $teaser
Write-Output $poster
