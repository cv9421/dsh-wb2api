# dsh-wb2api-panel 功能测试报告

| 项目 | 内容 |
|---|---|
| 被测对象 | `dsh-wb2api-panel` v1.0.0（WorkBuddy2API 网关的 DSH 插件） |
| 代码位置 | `C:\Users\CinderLumes\Desktop\as\wb2api-panel-plugin` |
| 运行环境 | Harness `desktop` profile，Web GUI `http://127.0.0.1:5954`；网关 `wb2api.exe v1.11.11-panel` 监听 `127.0.0.1:7863` |
| 测试时间 | 2026-10-28 |
| Oracle 命令 | `node test/run.mjs`（退出码 0 才算通过） |
| 结果 | **43 用例 / 43 通过 / 0 失败**，`EXIT=0` |
| 完整日志 | `docs/test-run.log` |

---

## 1. 测试策略

测试不依赖人工点按，也不需要浏览器：React 用 40 行 shim 在 Node 里渲染真实组件树，HTTP 打真实线上链路（Harness → 插件 Host → 网关）。HTML 断言从**渲染产物**取文本，不是从源码取字符串，因此能抓到运行时崩溃与错误态泄漏。

分五层，从内到外：

```
L1 清单完整性      package.json / exports / files / patch / locale / icon
L2 客户端模块      ModuleLoader 注册、factory 依赖、slot 注册
L3 组件渲染        8 个 tab 真实渲染 + 点击交互 + 线上数据
L4 宿主模块        13 工具注册与执行、/wb2api 路由处理、白名单
L5 线上链路        装进 profile 的实例，经 Harness web server 访问
```

## 2. 用例明细

### L1 · 清单完整性（5）

| 用例 | 结果 | 证据 |
|---|---|---|
| package.json 可解析且声明 bundle patch | PASS | `dsh-wb2api-panel@1.0.0` |
| `files` / `exports` 指向的文件全部存在 | PASS | 6 项全部命中 |
| cordis.patch.yml 插入插件行并带 config | PASS | `row wb2api-panel` |
| 双语 locale 均含 meta 且 tab 键一致 | PASS | 8 tabs × 2 语言 |
| icon 为合法独立 SVG、<256 KiB、无远程引用 | PASS | 693 bytes |

### L2 · 客户端模块（3）

| 用例 | 结果 | 证据 |
|---|---|---|
| 产物按包 id 注册唯一 lazy factory | PASS | `id=dsh-wb2api-panel` |
| factory 只 require react，返回合法插件对象 | PASS | `inject=slots` |
| `apply` 注册 `settings.section` 页并给出活标签 | PASS | `id=wb2api-panel order=46 label=WorkBuddy 网关` |

### L3 · 组件渲染（11）

| 用例 | 结果 | 证据 |
|---|---|---|
| 首屏渲染出标题与概览卡片 | PASS | 含「WorkBuddy 网关」「概览」「账号总数」 |
| tab 概览/账号/登录/任务/模型/用量/诊断/日志 渲染不抛错 | PASS ×7 | 每个 tab 产 6.3–6.4 k 字符 |
| 账号 tab 渲染账号行与操作按钮 | PASS | 签到 / 复活·禁用 / 旅行·保活·活跃 |
| 诊断 tab 按需拉取线上指标 | PASS | 加载后出现「已完成」卡片 |
| 登录 tab 提供区服选择与授权链接生成 | PASS | 「国内版」「生成授权链接」 |

> 说明：断言里带 `Cannot read | undefined is not | is not a function` 反查，防止错误态被渲染成白屏还"通过"。

### L4 · 宿主模块（15）

| 用例 | 结果 | 证据 |
|---|---|---|
| 注册 `/wb2api` prefix 路由 | PASS | kind=prefix |
| 注册 13 个工具，schema 全部合法 | PASS | 名称集合完全匹配，每个含 description/parameters/output |
| `wb2api_status` 返回无损 JSON | PASS | 3 356 B，无 `undefined` |
| `wb2api_accounts` 列出账号池 | PASS | 4 个账号，uid/credits 类型正确 |
| `wb2api_models` 列出模型并报告准入能力 | PASS | 20 个模型，`gateSupported=false` |
| `wb2api_login` 取到地区列表 | PASS | 7 个地区 |
| `wb2api_tasks` 读队列 | PASS | `running=false` |
| `wb2api_tasks` 缺 uid 时报错而非静默 | PASS | `uid is required` |
| `wb2api_diagnostics` 五种 kind 全部 200 | PASS | metrics/requests/packages/vouchers/probes |
| `wb2api_usage` 返回 totals | PASS | requests=0 |
| `wb2api_logs` 返回日志条目 | PASS | 216 条 |
| `wb2api_config` 正确解包 `{config}` 信封 | PASS | `listen=127.0.0.1:7863` |
| 版本门控工具在当前二进制上可用 | PASS | clientkeys=200 security=200 |
| 模型准入：支持则往返，不支持则明确自报 | PASS | `cn:hy4-preview` 往返切换并已还原 |
| `wb2api_service` 探活 | PASS | healthy=1 total=5 |

### L4 · 代理路由（6）

| 用例 | 结果 | 证据 |
|---|---|---|
| `GET /wb2api/health` 返回快照 | PASS | `service.running=true` |
| `GET /wb2api/data` 放行白名单路径 | PASS | accounts=4 |
| `GET /wb2api/data` 拒绝非白名单路径 | PASS | 400 `path not allowed` |
| 未知子路由返回 404 不崩 | PASS | `unknown route: /nope` |
| 仅 POST 的 `/wb2api/action` 拒绝 GET | PASS | 405 |
| `proc?action=logs` 返回 stdout 尾部 | PASS | 1 行 |

### L5 · 线上链路（3）

| 用例 | 结果 | 证据 |
|---|---|---|
| 经 Harness 访问 `/wb2api/state` | PASS | 200，`baseUrl=http://127.0.0.1:7863` |
| bundle 已链入 profile | PASS | `...\profiles\desktop\node_modules\dsh-wb2api-panel` |
| 网关 `/healthz` 直连 | PASS | 200 |

## 3. 测试过程中发现并修复的缺陷

| # | 缺陷 | 严重度 | 证据 | 修复 |
|---|---|---|---|---|
| 1 | 工具返回对象含 `undefined` 字段，框架判为「非无损 JSON」，工具整体失败 | 高（功能不可用） | `tool "wb2api_status" returned invalid output: value is not lossless JSON` | 所有工具返回值经 `clean()`（`JSON.parse(JSON.stringify())`）收敛 |
| 2 | `/panel/api/config` 应答是 `{config:{...}}` 信封，`wb2api_config` 直接透传导致取不到字段 | 中（读到空壳） | 用例断言 `config.listen` 失败，实测 `config.config.listen` 才存在 | 新增 `unwrapConfig()`，兼容两种形态 |
| 3 | 模型准入开关在无该端点的二进制上被当成"有"：列表里 `disabled` 恒为 undefined，UI 把所有模型显示成「已启用」 | 中（误导） | 二进制里 grep 不到 `models/toggle`；`POST` 返回 404 | 工具改为从 `config.models.disabled` 探测能力，输出 `gateSupported` + `disabled:null`；UI 在无能力时给出黄色提示并禁用开关 |
| 4 | 客户端半在 Node 沙箱里所有 fetch 静默失败（沙箱在 mock 安装前捕获了裸 fetch），导致 3 个渲染用例误报 | 测试设施缺陷 | 修复前 accounts/diagnostics 用例失败，修复后全绿 | 把 URL 重写 mock 提前到沙箱创建之前 |
| 5 | icon 用例误判 `xmlns="http://www.w3.org/2000/svg"` 为远程资源引用 | 测试用例缺陷 | 误报 | 正则收窄到 `src=/href=/url()` |

## 4. 版本门控（重要，非缺陷）

从运行中的二进制里直接抽取路由字面量并与源码比对：

```
$ node -e "...regex /panel/api/[A-Za-z0-9_./{}-]* over wb2api.exe..."
```

| 端点 | 源码 checkout | 当前二进制 v1.13.0-panel | 插件行为 |
|---|---|---|---|
| `models/toggle` | 有 | **有** | 正常往返（`cn:hy4-preview` 实测） |
| `clientkeys` | 有 | **有** | 工具返回 200 + 数据 |
| `security` | 有 | **有** | 工具返回 200 + 数据 |
| `apimonitor` | 有 | 有 | 未接入（无工具/UI） |

结论：二进制已升级到 `1.13.0-panel+modelswitch+hidettitle+dirtycfg+secmon`，上述门控全部可用；仍保留能力探测，换回旧二进制时工具会明确自报「本二进制不支持」而不是假装成功。

## 5. 覆盖度

原面板 42 条 `/panel/api/*` 路由：

- **39 条已接入**（工具或 UI 直达）
- **3 条未接入**：`import/cockpit`（驾驶舱导入）、`usage/save`（用量手改）、`apimonitor`

## 6. 未覆盖与残余风险

| 项 | 说明 |
|---|---|
| 视觉呈现 | 无浏览器控制权限，`/` 页面要求 `dsh web` 会话鉴权，截图不可得。已确认：组件渲染不抛错、slot 注册 active、数据链路通。**排版/配色未经人眼确认。** |
| 真实扫码登录 | 只验证到「拿到授权链接 + 轮询链路可达」，没有真的完成一次第三方授权（需要你本人扫码）。 |
| 队列实跑 | `run_queue` 未在测试中真实启动（会给上游发大量请求），只验证了队列读取与启动前的校验。 |
| 破坏性操作 | `remove` 账号、`import/cockpit`、`usage/save`、`config save` 均未在测试中执行，避免污染线上状态。 |
| 上游 401 | 部分账号的 enterprise 端点鉴权失效，`packages`/`vouchers`/单账号 `tasks` 会带出上游 401。插件如实透传，不是插件缺陷。 |
| 路由鉴权 | `/wb2api/*` 未校验 Harness 会话（只读面板数据 + 本机进程控制，绑定 127.0.0.1）。如需与远程实例共存，需加会话校验。 |

## 7. 复现

```powershell
cd C:\Users\CinderLumes\Desktop\as\wb2api-panel-plugin
node test/run.mjs            # 43 用例，退出码即结论
```

可用环境变量指向别的实例：`WB2API_TEST_BASE`（Harness origin）、`WB2API_TEST_PANEL`（网关 origin）。

## 8. 安装自动化验证（干净安装模拟）

目标：让第三方在**不改任何 YAML** 的前提下装完即用。把 profile 里已注入的 `wb2api` 段与
`WB2API_API_KEY` 凭据全部删掉、停掉网关，再走一次真实的卸载/装载，观察插件能否自动补齐。

| 环节 | 期望 | 实测结果 |
|---|---|---|
| `panelDir` 自动发现 | 删掉显式配置也能找到面板目录 | PASS：`C:\Users\CinderLumes\Desktop\as\workbuddy2api-panel`（经真实路径回溯命中） |
| 网关自动拉起 | 停掉后装载即恢复监听 | PASS：`service.running=true`，`uptime_sec` 重新计时 |
| 凭据自动写入 | 删除后自动写回 `WB2API_API_KEY` | PASS：`credential.ok=true, stored=true` |
| provider 自动注册 | profile 长出 `wb2api` 段 | PASS：21 个模型，19 个带 `reasoningEfforts` |
| 网关未就绪时 | 等待而不是放弃 | PASS：`waitForGatewayReady()` 轮询最长 24s |
| 自激保护 | 写文件不得触发无限重写 | PASS：连跑 30s 后仍为**单段**、行数稳定 262 |

### 本轮发现并修复的缺陷

| # | 缺陷 | 严重度 | 证据 | 修复 |
|---|---|---|---|---|
| 4 | `panelDir` 写死维护者路径，别人装完读不到 key、也起不了进程 | 高（安装即失败） | 硬编码 `C:\Users\CinderLumes\Desktop\as\workbuddy2api-panel` | 多候选自动发现；全落空时明确降级为远程只读模式 |
| 5 | 注入只在装载后 2.2s 单次尝试，冷启动竞态下直接失败 | 高 | 冷启动时 `/v1/models` 尚未就绪 | `waitForGatewayReady()` 轮询 + 4s×30 次兜底重试 |
| 6 | `llm-pi-ai` 缺失时只写 stderr，用户看不到 | 中 | 日志里有、页面上没有 | 返回 `code: LLM_PI_AI_MISSING`，页顶显示提示条 |
| 7 | 宿主 HMR 事务内调用 `configEditor.edit` 必抛 `HMR transactions cannot be nested` | 高（自动注入整条失效） | 连续 10+ 次重试同一错误；工具调用却成功（不同 fiber） | 改为直接改写 profile `cordis.patch.yml`，幂等 + 去重 |
| 8 | 文件层写入触发「对账 → 重载 → 再写」自激循环 | 高（会写坏配置） | profile patch 从 81 行涨到 **1349 行**、重复 7 段 | `readPatchFileProvider()` 短路：文件里已有同规模段即认账 |
| 9 | 生成 YAML 时缩进写死 6 空格，而实际 `providers:` 在 4 空格 | 高（配置语义错误） | PyYAML 解析出 `providers keys: ['k','providers']`（套出了嵌套键） | 缩进由文件实际层级推算（`indentOf(providersAt) + 2`） |

修完后用 PyYAML 复核结构：`providers keys: ['wb2api','k']`、`models: 21`、`with reasoningEfforts: 19`。
