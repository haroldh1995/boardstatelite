$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$output = Join-Path $PSScriptRoot "..\narration.wav"
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speech.Rate = -2
$speech.Volume = 100
$voice = $speech.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like "en-*" } | Select-Object -First 1
if ($voice) { $speech.SelectVoice($voice.VoiceInfo.Name) }
$speech.SetOutputToWaveFile($output)
$speech.Speak("Commander gets complicated. Keeping track of it should not. Meet BoardState Lite. Built for the way you actually play. Track your battlefield, manage your counters, and keep your game moving. Lite handles the bookkeeping it understands, and lets you make the decisions that matter. Remember what you have activated. Correct mistakes in seconds. Stay focused on the game. More than a life counter. An intelligent companion for your entire Commander experience. Less bookkeeping. More Magic. BoardState Lite. Play the cards. Let Lite handle the bookkeeping. Try BoardState Lite today.")
$speech.SetOutputToDefaultAudioDevice()
$speech.Dispose()
Write-Output $output
