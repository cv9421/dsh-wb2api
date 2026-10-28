# dsh-wb2api-panel

> WorkBuddy2API（[`cv9421/2api`](https://github.com/cv9421/2api)（fork 自 linguo2625469/workbuddy2api-panel））的 DeepSeek Harness 插件：在 Harness 里管理账号池、任务中心、用量与日志，并托管本机网关进程。

Go 网关保持不动、继续当唯一事实源；插件只做外壳——原生面板 + 进程托管 + 13 个 Agent 工具。**不重写后端，不用 iframe**（原面板自带 `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`，物理屏蔽嵌套）。

## 能力

**页面**（设置 → WorkBuddy 网关）

| Tab | 内容 |
|---|---|
| 概览 | 池状态卡片、版本、运行时长、Redis 模式、粘性会话、账号速览 |
| 账号 | 批量签到/余额/旅行/活跃/保活；逐账号 签到·余额·暂停·恢复·禁用·复活·任务直达 |
| 登录 | cn/global 区服 → 生成授权链接 → 自动轮询 → 成功后就地显示积分并热刷新池 |
| 任务 | 队列状态、并发与成长奖励开关、扫描/运行队列、队列明细、单账号任务（进度+奖励+接受/领取/自动） |
| 模型 | 倍率/上下文/能力一览；准入开关（二进制无该端点时自动降级为只读并提示） |
| 用量 | 合计卡 + 按模型 / 按账号分组 |
| 诊断 | 请求指标、请求日志、订阅包余量、券、模型探测 |
| 日志 | 面板日志 + 进程 stdout 尾部 |

**Agent 工具**（13）

`wb2api_status` `wb2api_accounts` `wb2api_bulk` `wb2api_login` `wb2api_tasks` `wb2api_models` `wb2api_usage` `wb2api_logs` `wb2api_diagnostics` `wb2api_config` `wb2api_service` `wb2api_clientkeys` `wb2api_security`

## 安装

```powershell
plugin_manager install_bundle  target=<本仓库的绝对路径>
# 改配置后让它重新应用（注意：这不重载代码，见下文）
plugin_manager set_plugin     target=include:wb2api-panel enabled=false
plugin_manager set_plugin     target=include:wb2api-panel enabled=true
```

## 推送（本机注意）

本机有三个坑，推送统一用脚本：`url.https://gh-proxy.com/...insteadOf` 会把 GitHub 地址改写成只读代理（push 必失败）、全局 `http.proxy=127.0.0.1:7897`（Clash Verge 没启动时端口是空的）、GitHub 的 receive-pack 直连会被重置。

```powershell
pwsh -File scripts/push.ps1
```

脚本会临时摘掉 insteadOf、自动探测可用代理、推送后还原全局配置。**前提：Clash Verge 主程序已启动**（`clash-verge-service` 在跑不代表端口在听）。
## 别人怎么装（先看这三条前提）

**1）这个插件只是壳，后端要你自己跑。** 仓库里没有 `wb2api` 二进制——它属于上游 Go 项目 [cv9421/2api](https://github.com/cv9421/2api)。没跑网关时，插件能装、页面能开，但只有「未连接」。

**2）`panelDir` 会自动发现，不必再手改维护者路径。** 解析顺序：

1. config `panelDir`，或环境变量 `WB2API_PANEL_DIR`
2. 插件同级目录 `../workbuddy2api-panel`
3. 当前工作目录下的 `workbuddy2api-panel`
4. `~/Desktop/workbuddy2api-panel`、`~/workbuddy2api-panel`、`~/.dsh/wb2api`、`~/.wb2api`、`%LOCALAPPDATA%\wb2api`
5. 还没命中就做一次**有界搜索**：在 `Desktop` / `Documents` / `Downloads` / 家目录下按目录名找 `wb2api.exe`（深度 ≤ 3，跳过 `node_modules`、`.git`、`AppData`），命中即缓存

命中条件：目录里存在 `wb2api.exe`（或你自定义的 `exe`）或 `config.json`。全部落空时插件退化为**远程只读模式**——面板与工具照常，只有进程托管不可用，页面顶部给黄色提示条，不会静默。

**key 怎么来的**（三级降级，401 时会告诉你卡在哪一级）：`config.apiKey` / `WB2API_KEY` → 面板 `config.json` 的 `api_key` → 凭据库 `WB2API_API_KEY`。`/wb2api/state` 的 `apiKeySource` 会返回 `config` / `config.json` / `credential` / `none`。
| 只管远程网关（读账号/用量/日志） | `baseUrl` + `apiKey`，**不需要** `panelDir` |
| 也要启停本机网关进程 | `panelDir` 指到含 `wb2api.exe` 的目录（或放上面某个默认位置） |
| 不想改 YAML | 设环境变量 `WB2API_BASE_URL` / `WB2API_KEY` / `WB2API_PANEL_DIR`（优先级高于 YAML） |

**3）要模型提供商自动注册，profile 里必须有 `llm-pi-ai`。** 插件复用它的 `openai-completions` 适配器，不自己写 adapter。缺失时不会静默：页面顶栏显示「缺少 llm-pi-ai」，`wb2api_provider status` 也会给出 `code: LLM_PI_AI_MISSING`。

**4）进程托管是 Windows 优先。** 启停用 `taskkill` + `data/server.pid`；Linux/macOS 走 `process.kill` 分支但未在那边验证过。

### 装好后自动完成的事

| 时机 | 动作 |
|---|---|
| 装载后 1.2s | 网关没在跑就拉起来（幂等） |
| 装载瞬间 | 注册 `/wb2api/*` 路由；`webServer` 没就绪就每 2s 重试，不会静默丢路由 |
| 装载后约 2s，且网关已就绪 | 把 `wb2api` provider 写进 profile，并把 key 写进 `WB2API_API_KEY` 凭据 |
| 网关尚未就绪 | 轮询等待（最长 24s），之后每 4s 重试，最多 30 次 |
| 每次取状态 | 比对自身文件 mtime：磁盘变了而内存还是旧代码 → `code.stale=true`，页面红条提示重启 |
| 卸载插件 | 停掉网关（`stopOnUnload: true`） |

> **已知宿主限制**：DSH 把「插件装载 / 热更新」整体包在 HMR 事务里，此时调用 `configEditor.edit` 必抛 `HMR transactions cannot be nested`，与重试多久无关。插件检测到这种情况会改为**直接改写 profile 的 `cordis.patch.yml`**（幂等、带去重，不会重复追加），Loader 对账后同样生效。这是实测出来的绕行路径。

### 装法

```powershell
# 从 GitHub（推荐）
plugin_manager install_bundle  target=https://github.com/cv9421/dsh-wb2api

# 或先 clone 再按本地目录装
git clone https://github.com/cv9421/dsh-wb2api
plugin_manager install_bundle  target=<克隆目录的绝对路径>
```

装完在 **设置 → WorkBuddy 网关** 里配置。

只改了 `cordis.patch.yml` 里的**配置值**，disable/enable 就能重新应用：

```powershell
plugin_manager set_plugin  target=include:wb2api-panel enabled=false
plugin_manager set_plugin  target=include:wb2api-panel enabled=true
```

> **升级插件代码后，别指望 disable/enable。**
> 实测：disable/enable 只重新跑 `apply()`，**不重新加载模块**（ESM 缓存按 URL 命中），
> 新代码不生效、页面也看不到新字段。要加载新版本，用 `remove_bundle` + `install_bundle`
> 重装（本次实测会触发重新加载），或者干脆完全退出重启 DSH——最稳。
>
> 忘了重启也不用猜：插件会比对自身文件 mtime，发现磁盘已更新但仍在跑旧代码时，
> `/wb2api/state` 返回 `code.stale=true`，页面顶部直接提示重启。
## 配置

装配行在 `cordis.patch.yml`，字段也可以用环境变量覆盖（环境变量优先）：

| config | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | `WB2API_BASE_URL` | `http://127.0.0.1:7863` | 网关地址，可指向远程实例 |
| `apiKey` | `WB2API_KEY` | 空 | 留空则自动读 `panelDir/config.json` 的 `api_key` |
| `panelDir` | `WB2API_PANEL_DIR` | 空（自动发现） | 面板目录：读配置、拉进程、看日志。留空时按上面的顺序探测 |
| `exe` | `WB2API_EXE` | `wb2api.exe` | 二进制文件名 |

> 留空即可。只有自动发现全落空（比如你把网关放在别处）时才需要显式指定 `panelDir`。

## 架构

```
浏览器 (Harness Web GUI)
   │  fetch('/wb2api/...')   同源，无 CORS、无 iframe
   ▼
Client 半  client.js        设置页 8 个 tab（React，跟随 --dsw-alias-* 主题令牌）
Host 半    index.js         /wb2api 前缀路由（注入 Bearer api_key、路径白名单）
                            进程托管（start/stop/restart/health/logs） + 13 工具
   ▼
wb2api.exe  :7863           /panel/api/*  +  /healthz  +  /v1/*（OpenAI 兼容）
```

UI 按钮与 Agent 工具调用**同一套 Host 方法**，不存在两套逻辑。

## 测试

```powershell
node test/run.mjs      # 43 用例，退出码即结论
```

五层：清单完整性 / 客户端模块 / 组件渲染（Node 里真渲染 + 点击 + 线上数据）/ 宿主工具与路由 / 线上链路。
详细结果见 [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md)，插件设计见 [`docs/PLUGIN-REPORT.md`](docs/PLUGIN-REPORT.md)。

## 兼容性

| 端点 | 需要 |
|---|---|
| 概览/账号/用量/日志/任务/登录/诊断 | `wb2api v1.11.x` 即可 |
| 逐模型准入开关 `models/toggle` | 更新的二进制；缺失时插件自报 `gateSupported:false` |
| `clientkeys` / `security` / `apimonitor` | 同上，缺失时返回 404 说明而不是假装成功 |

## 安全边界

- `/wb2api/*` 只放行 `/panel/api/`、`/healthz`、`/status`、`/v1/models`，不是开放代理
- `api_key` 只在 Host 侧注入，浏览器拿不到
- 请求体上限 1 MB；响应 `cache-control: no-store`
- 卸载插件不会杀网关进程（进程归用户）
- 已知缺口：`/wb2api/*` 不校验 Harness 会话，默认只绑 `127.0.0.1`

## License

MIT，见 [LICENSE](LICENSE)。
