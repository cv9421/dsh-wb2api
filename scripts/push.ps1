# 一次性推送脚本
#
# 为什么需要它：
#   1) 你的全局 git 配置里有 url.https://gh-proxy.com/https://github.com/.insteadOf=https://github.com/
#      —— 会把所有 GitHub 地址改写成 gh-proxy，而 gh-proxy 不支持 push 认证；
#   2) git 还配了 http.proxy=127.0.0.1:7897 —— 代理没起来时连不上。
#   本脚本在 push 期间临时绕过这两条，push 结束（无论成败）自动还原全局配置。
#
# 用法：
#   pwsh -File scripts/push.ps1
#   首次会弹出 Git Credential Manager 的登录窗口，浏览器里完成 GitHub 授权即可。
#   之后再推送直接跑同一条命令，凭据已被 GCM 记住。

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$rule = 'url.https://gh-proxy.com/https://github.com/.insteadOf'

Push-Location $repo
$hadRule = (git config --global --get $rule) 2>$null
$exit = 1
try {
    if ($hadRule) { git config --global --unset-all $rule | Out-Null }

    # 直接写 .git/config，避免 set-url 时又被 insteadOf 改写
    git config --local remote.origin.url 'https://github.com/cv9421/dsh-wb2api.git'

    git -c http.proxy= -c https.proxy= push -u origin main
    $exit = $LASTEXITCODE
}
finally {
    if ($hadRule) { git config --global --add $rule 'https://github.com/' | Out-Null }
    Pop-Location
}

if ($exit -eq 0) {
    Write-Host '[push] 成功：https://github.com/cv9421/dsh-wb2api' -ForegroundColor Green
} else {
    Write-Host "[push] 失败（exit=$exit）。若提示认证失败，重跑本脚本并在弹出的窗口里完成 GitHub 登录。" -ForegroundColor Yellow
}
exit $exit
