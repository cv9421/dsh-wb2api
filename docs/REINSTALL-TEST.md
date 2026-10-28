# 卸载 / 重装 实战测试报告

> 目的：回答一个问题——**别人把插件从 GitHub 装上，到底能不能用。**
> 方法：不是看代码"应该没问题"，而是真删、真装、真跑，拿运行时的状态说话。

- 测试时间：2026-10-28
- 被测对象：`https://github.com/cv9421/dsh-wb2api`
- 版本轨迹：`1.0.0` → `1.1.0` → `1.2.0`
- 环境：Windows，DSH 0.2.1-rc.3，网关 `wb2api 1.13.0-panel`（127.0.0.1:7863）

---

## 1. 结论先说

**第一版（1.0.0）从 GitHub 装完是用不了的**，而且不是小毛病：插件能加载、工具能出现，但
`panelDir` 找不到 → 读不到 `api_key` → 网关起不来 → 模型提供商注入失败，用户看到的是一串 HTTP 401。

三轮"删掉→重装→实测"共挖出 **9 个缺陷**，全部已修复并推到 `1.2.0`。当前实测状态：**装完即用**。

---

## 2. 测试过程（真做了什么）

| 轮次 | 动作 | 结果 |
|---|---|---|
| R1 | 删掉本地 `link:` 安装 → 从 GitHub 装 `1.0.0` | 装上但注入失败：`file fallback failed: profile directory not found` |
| R2 | 清成新用户状态（删 provider 段 + 删凭据 + 停网关）→ 重装 | 网关自动起来了、凭据自动写了，但 provider 段没写进去 |
| R3 | DSH 进程重启后再测（GUI 端口 5954 → 1419） | 拿到干净安装的真实状态，定位到三处根因 |
| R4 | 修复后装 `1.2.0` | 面板目录自动命中、key 命中、网关 running、provider 21 模型 |

关键动作之一：**把运行中的真实状态打出来**，而不是靠日志猜：

```
profileDir   = C:\Users\CinderLumes\.dsh\profiles\desktop
panelDir     = ""                        ← 空
apiKeySource = "none"                    ← 没有 key
service      = running=false             ← 网关没起
provider     = gateway not ready: gateway not listening on http://127.0.0.1:7863
```

这张表就是"装完为什么用不了"的完整证据链。

---

## 3. 缺陷清单（9 个）

| # | 缺陷 | 严重度 | 证据 | 修复 |
|---|---|---|---|---|
| 1 | 卸载后 `node_modules/dsh-wb2api-panel` 的 junction 残留，仍指向用户源码目录 | 低 | 卸载后 `Test-Path` 为真、`LinkType=Junction` | 记录在案（安装器行为） |
| 2 | 真实目录安装时 `selfProfileDir()` 返回空，注入的文件兜底整条失效 | 高 | `provider: "…file fallback failed: profile directory not found"` | 改为从 `<profile>/node_modules/<pkg>` 反推父目录 |
| 3 | **disable/enable 与重装都不重新加载模块**，新代码不生效 | 高 | 装好的 `index.js` 含 `profileDir`/`diagHere`，`/wb2api/state` 返回的键里一个都没有 | README 纠正：升级代码必须完全重启 DSH |
| 4 | 版本号长期停在 `1.0.0`，用户无法判断装到的是不是新版 | 中 | 三次安装输出都是 `1.0.0` | 升到 `1.1.0` / `1.2.0` |
| 5 | `panelDir` 只查固定候选，面板放在任意目录就落空 | **致命** | 干净安装后 `panelDir: ""` | 固定候选 + 有界搜索（Desktop / Documents / Downloads / 家目录，深度 3，跳过 `node_modules`/`.git`/`AppData`）；命中即缓存，空结果不缓存 |
| 6 | `api_key` 只从 `config.json` 读，凭据库里的 `WB2API_API_KEY` 明明在却不用 | 高 | `apiKeySource: "none"`，工具全 `HTTP 401`，同一 key 直连网关 200 | `resolveApiKey()` 三级降级：配置 → `config.json` → 凭据库 |
| 7 | `webServer` 未就绪时 `register()` 直接 return，路由永久丢失 | 高 | `/wb2api/state` 持续 404，配置变更后才恢复 | 入队 + 每 2s 重试直到注册成功 |
| 8 | 401 只说 `HTTP 401`，不说是"路径没配"还是"密码错" | 中 | 12 个用例同时挂 401，无从下手 | `apiKeySource` 诊断 + 401 文案写明该设哪个字段 + 页面提示条 |
| 9 | 早期把 profile YAML 缩进写死 6 空格（实际 `providers:` 在 4 空格），套出嵌套 `providers` 键 | 高 | PyYAML 解析出 `providers keys: ['k','providers']` | 缩进按文件实际层级推算 |

---

## 4. 验收证据

### 4.1 Oracle（不认"我说好了"，只认套件）

同一套 43 个用例，对**装好的那一份**跑（`WB2API_PLUGIN_DIR` 指向 `node_modules` 里的产物）：

```
TOTAL 43  PASS 43  FAIL 0
```

且是在**中立工作目录 `C:\`、不设任何 `WB2API_*` 环境变量**下跑的——
意味着 `panelDir` 是靠有界搜索命中的，不是靠 `cwd` 撞对的。

### 4.2 安装产物校验

```
version      = 1.2.0
有界搜索     = 2 处
resolveApiKey= 2 处
flushRoutes  = 3 处
panelDir     = ''            (出厂配置留空，靠自动发现)
```

### 4.3 运行时状态（1.2.0 + 显式 panelDir 兜底）

```
panelDir     = C:\Users\CinderLumes\Desktop\as\workbuddy2api-panel
apiKeySource = config.json
service      = running=true  status=200
provider     = { ok: true, injected: 21 }
credential   = { ok: true }
```

### 4.4 profile 配置语义（PyYAML 复解）

```
providers keys: ['wb2api', 'k']
models: 21        其中 19 个带 reasoningEfforts（档位）
top-level entries: 8
```

---

## 5. 仍然存在的限制（不藏）

1. **升级代码必须重启 DSH。** disable/enable 只重新 `apply()`，ESM 模块缓存按 URL 命中，
   不会重新加载文件。这是宿主行为，插件侧无法绕过——已写进 README。
2. **UI 视觉未做人工确认。** 页面需要 `dsh web` 登录态，我只能验证到
   `/wb2api/state` 的数据结构、client 模块可渲染、8 个页签的渲染用例。
   提示条（`缺少 llm-pi-ai` / `没有读到 api_key`）的**实际观感**没有亲眼确认。
3. **有界搜索有代价。** 只扫用户目录下深度 3 的常见位置；面板放在 `D:\tools\...` 这类地方仍需
   显式配 `panelDir` 或 `WB2API_PANEL_DIR`。找不到时不会崩，走远程只读模式并给出提示。
4. **账号 401 与插件无关。** 网关上游账号 token 过期（`chat_stream ... upstream 401 ... openresty`），
   需要重新扫码登录，不属于本次缺陷范围。

---

## 6. 复现方式

```powershell
# 1) 卸载
plugin_manager remove_bundle  target=dsh-wb2api-panel

# 2) 重新从 GitHub 安装
plugin_manager install_bundle target=https://github.com/cv9421/dsh-wb2api

# 3) 等 5 秒后看真实状态（别只看日志）
Invoke-RestMethod http://127.0.0.1:<GUI端口>/wb2api/state
#   重点看：panelDir / apiKeySource / service.running / provider

# 4) 用套件验收（对装好的那一份）
$env:WB2API_PLUGIN_DIR="C:\Users\<你>\.dsh\profiles\desktop\node_modules\dsh-wb2api-panel"
$env:WB2API_TEST_BASE="http://127.0.0.1:<GUI端口>"
node test/run.mjs
```
