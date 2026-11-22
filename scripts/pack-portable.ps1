# 生成便携版压缩包：npm run pack:portable
# 需要先运行 npm run tauri build。输出 src-tauri/target/release/portable/NeumoReader_<版本>_x64-portable.zip
param([string]$Version)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
if (-not $Version) {
  $Version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
}
$Version = $Version.TrimStart('v')

$exe = Join-Path $root 'src-tauri/target/release/neumo-reader.exe'
if (-not (Test-Path $exe)) { throw "找不到 $exe，请先运行 npm run tauri build" }

$name  = "NeumoReader_${Version}_x64-portable"
$stage = Join-Path $root 'src-tauri/target/release/portable'
$dir   = Join-Path $stage $name
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $dir | Out-Null

Copy-Item $exe (Join-Path $dir 'neumo-reader.exe')
$utf8Bom = New-Object System.Text.UTF8Encoding $true
[IO.File]::WriteAllText((Join-Path $dir 'portable.flag'), "此文件存在时，拟物阅读以便携模式运行，数据保存在同目录的 data 文件夹。删除此文件即恢复为安装模式。`r`n", $utf8Bom)
$readme = Get-Content (Join-Path $root 'scripts/README-portable.txt') -Raw -Encoding UTF8
[IO.File]::WriteAllText((Join-Path $dir 'README-portable.txt'), ($readme -replace "`r?`n", "`r`n"), $utf8Bom)

$zip = Join-Path $stage "$name.zip"
Compress-Archive -Path $dir -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
Write-Output "已生成：$zip"
Write-Output "SHA-256：$hash"
