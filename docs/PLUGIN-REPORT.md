# dsh-wb2api-panel · 插件报告

**一句话**：把 `workbuddy2api-panel` 这个 Go 单机网关，变成长在 Harness 里的一等公民——原生面板 + 进程托管 + 13 个 Agent 工具，不重写后端、不用 iframe。

---

## 1. 为什么这么切

| 方案 | 判断 |
|---|---|
| 把 Go 后端重写成 TS 插件 | ✗ 10 万行上游协议模拟（SSE 重组、DSL 清洗、会话粘性、降级熔断），重写等于重做一个项目 |
| iframe 嵌原面板 | ✗ 原面板自带 `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`，物理屏蔽 |
| **保留 Go 网关 + 插件做外壳** | ✓ 后端不动，插件负责 UI / 进程 / 工具，升级二进制即得新功能 |

后端 `wb2api.exe` 继续监听 `:7863`，是唯一事实源；插件只读它的 JSON API、只 shell 它的二进制。

## 2. 架构

```
浏览器 (Harness Web GUI)
   │  fetch('/wb2api/...')  同源，无 CORS、无 iframe
   ▼
Client 半  client.js        设置 → WorkBuddy 网关（8 个 tab，React，跟随 --dsw-alias-* 主题令牌）
   │
   ▼
Host 半    index.js         /wb2api 前缀路由（注入 Bearer api_key、路径白名单）
   │                        进程托管（start/stop/restart/health/logs）
   │                        13 个 Agent 工具
   ▼
wb2api.exe  :7863           /panel/api/*  +  /healthz  +  /v1/*（OpenAI 兼容）
   └ data/state.json · auths/*.json · logs/
```

**一个操作，两个入口**：UI 按钮和 Agent 工具走同一套 Host 方法（如账号复活 = `POST /panel/api/accounts/{uid}/revive`），不存在两套逻辑。

## 3. 能力面

### 页面（设置 → WorkBuddy 网关，order 46）

| Tab | 内容 |
|---|---|
| 概览 | 6 张池状态卡 + 版本/运行时长/Redis/粘性会话/地址 + 账号速览 |
| 账号 | 5 种批量任务、逐账号 签到·余额·暂停/恢复·禁用/复活·任务直达 |
| 登录 | cn/global 区服 → 生成授权链接 → 2.5s 轮询 → 成功后就地显示积分并热刷新池 |
| 任务 | 队列状态机、并发与成长奖励开关、扫描/运行队列、队列明细、单账号任务（进度条+奖励+接受/领取/自动） |
| 模型 | 20 个模型的倍率/上下文/能力，准入开关（无该端点的二进制自动降级为只读） |
| 用量 | 合计卡 + 按模型/按账号分组 |
| 诊断 | 请求指标、请求日志（列动态生成）、订阅包余量、券、模型探测 |
| 日志 | 面板日志 + 进程 stdout 尾部 |

### 工具（13）

`wb2api_status` `wb2api_accounts` `wb2api_bulk` `wb2api_login` `wb2api_tasks` `wb2api_models` `wb2api_usage` `wb2api_logs` `wb2api_diagnostics` `wb2api_config` `wb2api_service` `wb2api_clientkeys` `wb2api_security`

### 覆盖度

原面板 42 条 API 路由 → **接入 39 条**。未接入 3 条：`import/cockpit`、`usage/save`、`apimonitor`。

## 4. 配置

`cordis.patch.yml` 的 `config`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:7863` | 网关地址，可指向远程实例 |
| `apiKey` | 空 | 留空则自动读 `panelDir/config.json` 的 `api_key` |
| `panelDir` | `...\Desktop\as\workbuddy2api-panel` | 面板目录：读配置、拉进程、看日志 |
| `exe` | `wb2api.exe` | 二进制文件名 |

## 5. 安装 / 卸载

```powershell
# 安装（幂等：已装则用 set_plugin 关→开强制重载）
plugin_manager install_bundle  target=C:\Users\CinderLumes\Desktop\as\wb2api-panel-plugin

# 卸载
plugin_manager remove_bundle   target=dsh-wb2api-panel
```

本机已装并生效：`application: applied`，`warnings: []`。

## 6. 安全边界

- `/wb2api/*` 只放行 `/panel/api/`、`/healthz`、`/status`、`/v1/models` 前缀，**不是开放代理**
- `api_key` 由 Host 注入，浏览器侧拿不到
- 请求体上限 1 MB，响应 `no-store`
- 卸载插件**不会**杀网关进程（进程归用户）
- 已知缺口：`/wb2api/*` 不校验 Harness 会话，绑定 127.0.0.1；与远程实例共存时需补会话校验

## 7. 验证状态

| 项 | 状态 |
|---|---|
| 功能测试 | **43/43 通过**（`node test/run.mjs`，退出码 0） |
| 工具执行 | 13 个工具全部实跑，含配置读取、日志、诊断五通道、能力探测 |
| 页面渲染 | 8 个 tab 在 Node 里真实渲染 + 交互，无抛错、无错误态泄漏 |
| 线上链路 | 经 Harness `:5954` 访问 `/wb2api/state` 200 |
| 视觉 | **未人眼确认**（无浏览器控制权限，页面需 `dsh web` 会话鉴权） |

## 8. 文件

| 文件 | 体量 | 职责 |
|---|---|---|
| `index.js` | 725 行 / 30 KB | Host：路由、进程托管、13 工具 |
| `client.js` | 1 281 行 / 57 KB | Client：8 tab 原生面板 |
| `cordis.patch.yml` | 7 行 | 装配行 + 配置默认值 |
| `locale/{zh,en}.json` | 90 行 ×2 | 插件显示元数据 |
| `icon.svg` | 693 B | 原创图标（节点网关） |
| `test/run.mjs` | 767 行 / 33 KB | Oracle 测试套件 |
| `docs/` | — | 本报告 + 测试报告 + 测试日志 |

## 9. 已知边界

1. **二进制版本门控**：运行中的 `v1.11.11` 缺 `models/toggle`、`clientkeys`、`security`、`apimonitor`（源码里有）。插件对这四处主动自报"不支持"，升级二进制后自动生效。
2. **上游鉴权**：部分账号 enterprise 端点 401 会导致 `packages`/`vouchers` 显示错误——网关侧问题，插件透传。
3. **视觉待验**：排版配色需要你打开设置页确认。
