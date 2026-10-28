# 一次性推送脚本
#
# 为什么要这个脚本（本机环境有三个坑）：
#   1) 全局 git 配置有 url.https://gh-proxy.com/https://github.com/.insteadOf=https://github.com/
#      —— 会把 GitHub 地址改写成 gh-proxy，而 gh-proxy 只做只读代理，push 一定会失败；
#   2) 全局 http.proxy = 127.0.0.1:7897（Clash Verge）。GUI 没启动时这个端口是空的，
#      GCM 和 git 都会报「无法连接 127.0.0.1:7897」；
#   3) GitHub 的 receive-pack（push 用的端点）直连会被重置/超时，必须走代理。
#
# 脚本做的事：临时摘掉 insteadOf → 探测代理是否可用 → 推送 → 无论成败还原全局配置。
#
# 用法：
#   pwsh -File scripts/push.ps1
#   若代理没起，先启动 Clash Verge（开始菜单里那个，不是 clash-verge-service）。

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$rule = 'url.https://gh-proxy.com/https://github.com/.insteadOf'
$proxies = @('http://127.0.0.1:7897', 'http://127.0.0.1:7890', 'http://127.0.0.1:10809')

function Test-Proxy([string]$url) {
    try {
        $uri = [Uri]$url
        $client = New-Object Net.Sockets.TcpClient
        $async = $client.BeginConnect($uri.Host, $uri.Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(1200)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { if ($client) { $client.Close() } }
}

Push-Location $repo
$hadRule = (git config --global --get $rule) 2>$null
$exit = 1
try {
    if ($hadRule) { git config --global --unset-all $rule | Out-Null }

    # 直接写 .git/config，避免 remote set-url 又被 insteadOf 改写
    git config --local remote.origin.url 'https://github.com/cv9421/dsh-wb2api.git'

    $proxy = $proxies | Where-Object { Test-Proxy $_ } | Select-Object -First 1
    $gitArgs = @('-c', 'http.version=HTTP/1.1', '-c', 'http.postBuffer=524288000')
    if ($proxy) {
        Write-Host "[push] 使用代理 $proxy" -ForegroundColor Cyan
        $gitArgs += @('-c', "http.proxy=$proxy", '-c', "https.proxy=$proxy")
    } else {
        Write-Host '[push] 未探测到可用代理，尝试直连（push 端点可能被重置）' -ForegroundColor Yellow
        $gitArgs += @('-c', 'http.proxy=', '-c', 'https.proxy=')
    }

    & git @gitArgs push -u origin main
    $exit = $LASTEXITCODE
}
finally {
    if ($hadRule) { git config --global --add $rule 'https://github.com/' | Out-Null }
    Pop-Location
}

if ($exit -eq 0) {
    Write-Host '[push] 成功：https://github.com/cv9421/dsh-wb2api' -ForegroundColor Green
} else {
    Write-Host "[push] 失败（exit=$exit）。先确认 Clash Verge 已启动（7897 在监听），再重跑。" -ForegroundColor Yellow
}
exit $exit
