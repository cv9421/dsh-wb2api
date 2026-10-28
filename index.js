/**
 * Host half of the WorkBuddy2API gateway panel bundle.
 *
 * It owns three things:
 *   1. a small same-origin HTTP surface (`/wb2api/*`) that the Client half fetches,
 *      proxying to the running wb2api gateway with its Bearer api key injected;
 *   2. process control for the local wb2api.exe (start / stop / restart / health);
 *   3. agent tools that expose the same operations to the model.
 *
 * The Go gateway stays the source of truth: this plugin never re-implements pool,
 * credit or routing logic, it only reads the panel JSON API and shells the binary.
 */
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const name = 'wb2api-panel';
export const inject = ['tools'];

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:7863',
  apiKey: '',
  panelDir: '',
  exe: 'wb2api.exe',
  autoStart: true,
  stopOnUnload: true,
  injectProvider: true,
};

/** Paths the proxy may reach; anything else is refused so this never becomes an open proxy. */
const ALLOWED_PREFIXES = ['/panel/api/', '/healthz', '/status', '/v1/models'];

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  // Environment wins over the patch row, so a clone works without editing the YAML.
  if (process.env.WB2API_BASE_URL) cfg.baseUrl = process.env.WB2API_BASE_URL;
  if (process.env.WB2API_PANEL_DIR) cfg.panelDir = process.env.WB2API_PANEL_DIR;
  if (process.env.WB2API_KEY) cfg.apiKey = process.env.WB2API_KEY;
  if (process.env.WB2API_EXE) cfg.exe = process.env.WB2API_EXE;
  const state = { child: null, startedAt: 0 };

  const baseUrl = () => String(cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, '');
  // panelDir 解析顺序：显式配置 → WB2API_PANEL_DIR → 常见位置探测。
  // 别人装到没有面板目录的机器上时，这里返回空 —— 插件退化成「只读远程网关」，
  // 不再拿着一个不存在的路径去读 key、拉进程。
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  // 面板目录发现：先查固定候选，再做一次有界搜索。
  // 只查固定候选是不够的——面板放在任何自定义目录都会落空，
  // 而落空的后果是「读不到 api_key + 起不了网关 + 注入不了 provider」，整条链路断掉。
  let panelDirCache;
  function discoverPanelDir() {
    if (panelDirCache !== undefined) return panelDirCache;
    const exeName = cfg.exe || DEFAULTS.exe;
    const isPanel = (dir) => existsSync(path.join(dir, exeName)) || existsSync(path.join(dir, 'config.json'));

    const candidates = [
      process.env.WB2API_PANEL_DIR,
      cfg.panelDir,
      path.resolve(HERE, '..', 'workbuddy2api-panel'),
      path.resolve(process.cwd(), 'workbuddy2api-panel'),
      path.join(os.homedir(), 'Desktop', 'workbuddy2api-panel'),
      path.join(os.homedir(), 'workbuddy2api-panel'),
      path.join(os.homedir(), '.dsh', 'wb2api'),
      path.join(os.homedir(), '.wb2api'),
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'wb2api') : '',
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const dir = path.resolve(String(candidate));
      if (isPanel(dir)) {
        panelDirCache = dir;
        return dir;
      }
    }

    // 有界搜索：在常见根目录下按目录名找 wb2api.exe（深度受限、跳过 node_modules 等）。
    const roots = [
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Documents'),
      path.join(os.homedir(), 'Downloads'),
      os.homedir(),
    ].filter(Boolean);
    const SKIP = new Set(['node_modules', '.git', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)', '$Recycle.Bin', 'System Volume Information']);
    const MAX_DEPTH = 3;
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH) return '';
      let entries = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return '';
      }
      // 同一层先看目录自身，再看子目录：先命中「最近」的那个。
      if (isPanel(dir) && existsSync(path.join(dir, exeName))) return dir;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        const found = walk(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }
      return '';
    };
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const found = walk(root, 0);
      if (found) {
        panelDirCache = found;
        return found;
      }
    }
    // 空结果不缓存：用户事后才把网关放上去时，不必重启就能被找到。
    return '';
  }
  const panelDir = () => (cfg.panelDir && existsSync(path.resolve(String(cfg.panelDir))) ? path.resolve(String(cfg.panelDir)) : discoverPanelDir());
  const exePath = () => (panelDir() ? path.join(panelDir(), cfg.exe || DEFAULTS.exe) : '');

  /** api_key: explicit config wins, otherwise read the gateway's own config.json. */
  /** key 从哪来的：排查 401 时唯一有用的一条信息。 */
  /**
   * key 解析（异步）：配置 -> 面板 config.json -> 凭据库 WB2API_API_KEY。
   * 凭据库这条很关键：插件自己把 key 写进过 WB2API_API_KEY，换台机器/丢了配置时
   * 只要凭据还在就该能用，而不是又变成一堆 401。
   */
  async function resolveApiKey() {
    const direct = apiKey();
    if (direct) return direct;
    const store = ctx.get('credentials');
    if (store && typeof store.resolve === 'function') {
      try {
        const resolved = await store.resolve(PROVIDER_KEY_REF);
        if (resolved && resolved.value) return String(resolved.value);
      } catch {
        /* 凭据库不可用就继续降级 */
      }
    }
    return ''
  }

  const apiKeySource = () => {
    if (cfg.apiKey) return 'config';
    const file = panelDir() && path.join(panelDir(), 'config.json');
    if (!file || !existsSync(file)) return 'none';
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return typeof parsed.api_key === 'string' && parsed.api_key ? 'config.json' : 'none';
    } catch {
      return 'none';
    }
  };

  const apiKey = () => {
    if (cfg.apiKey) return String(cfg.apiKey);
    const file = panelDir() && path.join(panelDir(), 'config.json');
    if (!file || !existsSync(file)) return '';
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return typeof parsed.api_key === 'string' ? parsed.api_key : '';
    } catch {
      return '';
    }
  };

  const target = () => {
    const url = new URL(baseUrl());
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    return { host: url.hostname, port };
  };

  /** `/panel/api/config` answers `{config:{...}}` on some builds and the map itself on others. */
  const unwrapConfig = (data) => (data && typeof data === 'object' && data.config ? data.config : data);

  // ---------------------------------------------------------------- HTTP layer

  async function callPanel(pathname, init = {}) {
    const headers = { accept: 'application/json', ...(init.headers || {}) };
    const key = await resolveApiKey();
    if (key) headers.authorization = `Bearer ${key}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    try {
      const res = await fetch(`${baseUrl()}${pathname}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(init.timeoutMs || 25000),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text.slice(0, 4000) };
      }
      const result = { ok: res.ok, status: res.status, data };
      // 401 且没带 key：这是「路径没配对」而不是「密码错了」，必须说清该配哪个字段，
      // 否则用户面对的只是一堆 HTTP 401。
      if (res.status === 401 && !key) {
        result.error =
          'HTTP 401：请求没带 api_key（' +
          (panelDir() ? '面板目录找到了，但 config.json 里没有 api_key' : '没找到面板目录，读不到 config.json 的 api_key') +
          '）。请设 apiKey，或设 WB2API_PANEL_DIR / WB2API_KEY 指向网关目录与 key。';
      }
      return result;
    } catch (error) {
      return { ok: false, status: 0, error: String(error && error.message ? error.message : error) };
    }
  }

  function portOpen(host, port, timeoutMs = 1200) {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  /** A 503 from /healthz still means the process is alive (no usable accounts). */
  async function health() {
    const { host, port } = target();
    if (!(await portOpen(host, port))) {
      return { running: false, reachable: false, host, port, detail: 'port closed' };
    }
    const res = await callPanel('/healthz', { timeoutMs: 8000 });
    if (res.error) {
      return { running: true, reachable: false, host, port, detail: res.error };
    }
    return {
      running: true,
      reachable: true,
      host,
      port,
      status: res.status,
      detail: res.status === 503 ? 'no usable account' : 'ok',
      health: res.data,
    };
  }

  // ------------------------------------------------------------- process layer

  function readPidFile() {
    if (!panelDir()) return 0;
    const file = path.join(panelDir(), 'data', 'server.pid');
    if (!existsSync(file)) return 0;
    try {
      const value = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function killPid(pid) {
    return new Promise((resolve) => {
      if (!pid) return resolve(false);
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (error) => resolve(!error));
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }

  /** 监听某端口的进程（pid 文件过期 / 进程被外部拉起时的兜底）。 */
  function pidOnPort(port) {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('netstat', ['-ano'], (error, stdout) => {
          if (error || !stdout) return resolve(0);
          for (const line of stdout.split(/\r?\n/)) {
            if (!/LISTENING/i.test(line)) continue;
            const cols = line.trim().split(/\s+/);
            if (cols.length < 5) continue;
            if (!(cols[1] || '').endsWith(':' + port)) continue;
            return resolve(Number(cols[cols.length - 1]) || 0);
          }
          resolve(0);
        });
        return;
      }
      execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], (error, stdout) => {
        if (error || !stdout) return resolve(0);
        resolve(Number(String(stdout).trim().split(/\s+/)[0]) || 0);
      });
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function start({ waitMs = 12000 } = {}) {
    const current = await health();
    if (current.running) return { ok: true, already: true, status: current };
    const dir = panelDir();
    const exe = exePath();
    if (!dir || !exe || !existsSync(exe)) {
      return { ok: false, error: `wb2api executable not found: ${exe || '(panelDir unset)'}` };
    }
    mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const out = openSync(path.join(dir, 'logs', 'stdout.log'), 'a');
    const err = openSync(path.join(dir, 'logs', 'stderr.log'), 'a');
    const child = spawn(exe, [], {
      cwd: dir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
    });
    child.unref();
    state.child = child.pid;
    state.startedAt = Date.now();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(400);
      const probe = await health();
      if (probe.running) return { ok: true, pid: child.pid, status: probe };
    }
    return { ok: false, pid: child.pid, error: 'started but the port never opened', logs: tailLog(30) };
  }

  async function stop() {
    const before = await health();
    if (!before.running) return { ok: true, already: true, status: before };
    const pids = new Set([readPidFile(), state.child, await pidOnPort(target().port)].filter(Boolean));
    const killed = [];
    for (const pid of pids) {
      if (await killPid(pid)) killed.push(pid);
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await sleep(300);
      if (!(await health()).running) {
        state.child = null;
        return { ok: true, killed, status: await health() };
      }
    }
    return { ok: false, killed, error: 'process still listening after stop', logs: tailLog(30) };
  }

  async function restart() {
    const stopped = await stop();
    if (!stopped.ok) return { ok: false, phase: 'stop', ...stopped };
    const started = await start();
    return { ok: started.ok, stopped, started };
  }

  function tailLog(lines = 60) {
    if (!panelDir()) return [];
    const file = path.join(panelDir(), 'logs', 'stdout.log');
    if (!existsSync(file)) return [];
    try {
      return readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-lines);
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------ composite reads

  async function snapshot() {
    const [service, overview] = await Promise.all([health(), callPanel('/panel/api/overview')]);
    return {
      service,
      baseUrl: baseUrl(),
      panelDir: panelDir(),
      panelDirExists: Boolean(panelDir()) && existsSync(panelDir()),
      // 注入兜底要写这个目录：暴露出来才能判断「写不进去」是权限还是路径算错。
      profileDir: selfProfileDir(),
      apiConfigured: Boolean(apiKey()),
      apiKeySource: apiKeySource(),
      // 注入状态给 UI 用：失败原因要能在页面上看到，而不是只进 stderr。
      provider: injectState.provider,
      credential: injectState.credential,
      injectCheckedAt: injectState.checkedAt || undefined,
      overview: overview.ok ? overview.data : null,
      overviewError: overview.ok ? undefined : overview.error || `HTTP ${overview.status}`,
    };
  }

  async function accountAction(uid, action) {
    const map = {
      revive: 'revive',
      disable: 'disable',
      pause: 'pause',
      resume: 'resume',
      checkin: 'checkin',
      balance: 'balance',
      remove: 'remove',
    };
    const verb = map[action];
    if (!verb) return { ok: false, error: `unknown action: ${action}` };
    if (!uid) return { ok: false, error: 'uid is required' };
    const res = await callPanel(`/panel/api/accounts/${encodeURIComponent(uid)}/${verb}`, {
      method: 'POST',
      body: '{}',
      timeoutMs: 60000,
    });
    return { ok: res.ok, status: res.status, result: res.data, error: res.error };
  }

  async function bulkAction(kind) {
    const known = ['checkin_all', 'balance_all', 'travel_all', 'activity_all', 'keepalive_all'];
    if (!known.includes(kind)) return { ok: false, error: `unknown bulk action: ${kind}` };
    const res = await callPanel(`/panel/api/${kind}`, { method: 'POST', body: '{}', timeoutMs: 120000 });
    return { ok: res.ok, status: res.status, result: res.data, error: res.error };
  }

  // ------------------------------------------------------------- web surface

  const routes = [];
  // webServer 未必在 apply 时可用：直接 return 会让路由永久丢失，
  // 表现为 /wb2api/* 一路 404，直到某次配置变更重新 apply 才恢复（很难查）。
  // 所以先入队，再周期重试，直到注册成功。
  const pendingRoutes = [];
  const flushRoutes = () => {
    if (!pendingRoutes.length) return true;
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function') return false;
    while (pendingRoutes.length) {
      const route = pendingRoutes.shift();
      try {
        routes.push(webServer.register(route));
      } catch (error) {
        console.error('[wb2api-panel] route registration failed:', error);
      }
    }
    return true;
  };
  const register = (route) => {
    pendingRoutes.push(route);
    flushRoutes();
  };

  // 每 2s 试一次把路由装上；装完就停。插件卸载时由 effect 清掉。
  const routeTimer = setInterval(() => {
    if (flushRoutes()) {
      clearInterval(routeTimer);
    }
  }, 2000);
  if (routeTimer && typeof routeTimer.unref === 'function') routeTimer.unref();
  ctx.effect(() => () => clearInterval(routeTimer), 'wb2api-panel route timer');

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  register({
    kind: 'prefix',
    path: '/wb2api',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/wb2api', 'http://127.0.0.1');
        const route = url.pathname.slice('/wb2api'.length) || '/';

        if (route === '/health' || route === '/state') {
          return sendJson(res, 200, await snapshot());
        }

        if (route === '/proc') {
          const action = url.searchParams.get('action') || 'health';
          if (action === 'start') return sendJson(res, 200, await start());
          if (action === 'stop') return sendJson(res, 200, await stop());
          if (action === 'restart') return sendJson(res, 200, await restart());
          if (action === 'logs') {
            const lines = Number(url.searchParams.get('lines') || 80);
            return sendJson(res, 200, { lines: tailLog(Math.min(Math.max(lines, 1), 500)) });
          }
          return sendJson(res, 200, await health());
        }

        if (route === '/data') {
          const targetPath = url.searchParams.get('p') || '';
          if (!ALLOWED_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
            return sendJson(res, 400, { ok: false, error: 'path not allowed' });
          }
          const result = await callPanel(targetPath);
          return sendJson(res, result.ok ? 200 : result.status || 502, result);
        }

        if (route === '/action') {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' });
          const targetPath = url.searchParams.get('p') || '';
          if (!ALLOWED_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
            return sendJson(res, 400, { ok: false, error: 'path not allowed' });
          }
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 1_000_000) return sendJson(res, 413, { ok: false, error: 'body too large' });
          }
          const result = await callPanel(targetPath, {
            method: 'POST',
            body: body || '{}',
            timeoutMs: 120000,
          });
          return sendJson(res, result.ok ? 200 : result.status || 502, result);
        }

        return sendJson(res, 404, { ok: false, error: `unknown route: ${route}` });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
      }
    },
  });

  ctx.effect(() => () => {
    for (const dispose of routes.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  }, 'wb2api-panel routes');

  // ------------------------------------------------------------------- tools

  const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
  const output = (schema) => ({ schema, render: (_args, value) => text(value) });
  const jsonOutput = { type: 'object', additionalProperties: true };

  /** Tool results must be lossless JSON: drop undefined holes and non-finite numbers. */
  const clean = (value) => {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return { ok: false, error: 'result was not serializable' };
    }
  };

  const tool = (definition) => {
    const run = definition.execute;
    routes.push(
      ctx.tools.register({
        ...definition,
        output: definition.output || output(jsonOutput),
        execute: async (args, exec) => clean(await run(args, exec)),
      }),
    );
  };

  tool({
    name: 'wb2api_status',
    description:
      'WorkBuddy2API 网关状态：服务是否在跑、版本、运行时长、账号池计数（总数/健康/冷却/禁用/暂停）与每个账号的积分、状态、最近用量。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return await snapshot();
    },
  });

  tool({
    name: 'wb2api_accounts',
    description:
      '列出 WorkBuddy2API 账号池账号，或对单个账号执行操作（revive 复活 / pause 暂停 / resume 恢复 / disable 禁用 / checkin 签到 / balance 刷新余额 / remove 移除）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'revive', 'pause', 'resume', 'disable', 'checkin', 'balance', 'remove'] },
        uid: { type: 'string', description: '账号 uid，action 非 list 时必填' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const action = args && args.action ? String(args.action) : 'list';
      if (action === 'list') {
        const res = await callPanel('/panel/api/overview');
        if (!res.ok) return { ok: false, error: res.error || `HTTP ${res.status}` };
        const accounts = Array.isArray(res.data.accounts) ? res.data.accounts : [];
        return {
          ok: true,
          total: res.data.total,
          healthy: res.data.healthy,
          accounts: accounts.map((account) => ({
            uid: account.uid,
            nickname: account.nickname,
            realm: account.realm,
            credits: account.credits,
            credits_total: account.credits_total,
            disabled: account.disabled,
            cooling: account.cooling,
            until: account.until,
            in_flight: account.in_flight,
            requests: account.token_usage && account.token_usage.request_count,
            total_tokens: account.token_usage && account.token_usage.total_tokens,
            last_used_at: account.token_usage && account.token_usage.last_used_at,
            last_model: account.token_usage && account.token_usage.last_model,
          })),
        };
      }
      return await accountAction(args && args.uid, action);
    },
  });

  tool({
    name: 'wb2api_models',
    description:
      '列出 WorkBuddy2API 可用模型（上下文长度、计费倍率、能力标记、是否被面板禁用），或用 enabled=false 禁用某个模型的准入。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'toggle'] },
        id: { type: 'string', description: '模型 id，例如 cn:glm-5.3-flash' },
        enabled: { type: 'boolean', description: 'toggle 时目标状态' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const action = args && args.action ? String(args.action) : 'list';
      if (action === 'toggle') {
        if (!args || !args.id) return { ok: false, error: 'id is required' };
        const res = await callPanel('/panel/api/models/toggle', {
          method: 'POST',
          body: JSON.stringify({ id: args.id, hidden: args.enabled === false, disabled: args.enabled === false }),
        });
        if (res.status === 404) {
          return {
            ok: false,
            status: 404,
            gateSupported: false,
            error: 'this wb2api build has no per-model gate endpoint (upgrade the binary)',
          };
        }
        return { ok: res.ok, status: res.status, result: res.data, error: res.error };
      }
      const res = await callPanel('/panel/api/models');
      if (!res.ok) return { ok: false, error: res.error || `HTTP ${res.status}` };
      const models = Array.isArray(res.data.models) ? res.data.models : [];
      // The binary that owns the gate also persists `models.disabled` in config.json;
      // older builds answer /models without any gate endpoint at all.
      const cfgRes = await callPanel('/panel/api/config');
      const cfg = cfgRes.ok ? unwrapConfig(cfgRes.data) : null;
      const gateCfg = (cfg && cfg.models) || {};
      // 后端自述的 gate（新版二进制）优先；老二进制没有该字段，退回到看配置键。
      const gateInfo = (res.data && res.data.gate) || null;
      const toggleAvailable = gateInfo ? Boolean(gateInfo.toggle) : Array.isArray(gateCfg.disabled);
      const gateConfigKey = (gateInfo && gateInfo.config_key)
        ? String(gateInfo.config_key)
        : Array.isArray(gateCfg.disabled) ? 'disabled' : Array.isArray(gateCfg.hidden) ? 'hidden' : null;
      const disabledList = (gateInfo && Array.isArray(gateInfo.hidden))
        ? gateInfo.hidden
        : gateConfigKey ? gateCfg[gateConfigKey] : [];
      return {
        ok: true,
        count: models.length,
        gateSupported: toggleAvailable,
        gateConfigKey,
        disabled: disabledList,
        models: models.map((model) => ({
          id: model.id,
          name: model.name,
          vendor: model.vendor,
          credits: model.credits,
          context_length: model.context_length,
          max_output_tokens: model.max_output_tokens,
          supports_images: model.supports_images,
          supports_tool_call: model.supports_tool_call,
          disabled: gateConfigKey ? disabledList.includes(model.id) : null,
        })),
      };
    },
  });

  tool({
    name: 'wb2api_usage',
    description: 'WorkBuddy2API 用量合计：请求数、错误数、tokens、积分消耗、平均延迟与按区服/账号/模型的分组。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const res = await callPanel('/panel/api/usage');
      if (!res.ok) return { ok: false, error: res.error || `HTTP ${res.status}` };
      return { ok: true, usage: res.data };
    },
  });

  tool({
    name: 'wb2api_logs',
    description: '读取 WorkBuddy2API 最近的运行日志（服务端 sys/请求通道），用于排查上游错误与调度行为。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认 40，最大 300' },
        channel: { type: 'string', enum: ['all', 'sys', 'req'], description: '日志通道，默认 all' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const limit = Math.min(Math.max(Number((args && args.limit) || 40), 1), 300);
      const channel = (args && args.channel) || 'all';
      const res = await callPanel(`/panel/api/logs?limit=${limit}&ch=${channel === 'all' ? '' : channel}`);
      if (!res.ok) {
        return { ok: false, error: res.error || `HTTP ${res.status}`, stdout: tailLog(limit) };
      }
      return { ok: true, entries: res.data && res.data.entries ? res.data.entries : res.data };
    },
  });

  tool({
    name: 'wb2api_service',
    description:
      '控制本机 wb2api 网关进程：health 探活、start 启动、stop 停止、restart 重启。仅在配置了 panelDir 且本机存在 wb2api.exe 时可启停。',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['health', 'start', 'stop', 'restart'] } },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      const action = (args && args.action) || 'health';
      if (action === 'start') return await start();
      if (action === 'stop') return await stop();
      if (action === 'restart') return await restart();
      return await health();
    },
  });

  tool({
    name: 'wb2api_config',
    description: '读取或保存 WorkBuddy2API 网关配置（config.json）：action=get 返回当前配置，action=save 用提供的 patch 合并保存并热生效。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'save'] },
        patch: { type: 'object', additionalProperties: true, description: '要合并进配置的字段' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      const action = (args && args.action) || 'get';
      if (action === 'get') {
        const res = await callPanel('/panel/api/config');
        return { ok: res.ok, config: res.ok ? unwrapConfig(res.data) : null, error: res.error };
      }
      if (!args || !args.patch || typeof args.patch !== 'object') {
        return { ok: false, error: 'patch object is required' };
      }
      const res = await callPanel('/panel/api/config', { method: 'POST', body: JSON.stringify(args.patch) });
      return { ok: res.ok, status: res.status, result: res.data, error: res.error };
    },
  });

  tool({
    name: 'wb2api_provider',
    description:
      '把本机网关注册成 DSH 模型提供商（profile 的 llm-pi-ai.providers.wb2api）。action=status 只看状态，action=inject 执行注入（幂等，带备份与回读校验），action=credential 把网关 key 写进凭据库 WB2API_API_KEY。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'inject', 'credential'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      const action = (args && args.action) || 'status';
      const file = profilePatchPath();
      if (action === 'status') {
        const editor = ctx.get('configEditor');
        let shape = { available: Boolean(editor), hasEntries: Boolean(editor && typeof editor.entries === 'function') };
        if (shape.hasEntries) {
          const rows = editor.entries() || [];
          shape.count = rows.length;
          shape.sample = rows.slice(0, 4).map((row) => ({
            keys: row && typeof row === 'object' ? Object.keys(row) : [],
            id: row && row.id,
            name: row && row.name,
            patchId: row && row.patchId,
          }));
          shape.matchesLlm = rows
            .filter((row) => {
              const blob = JSON.stringify(row && typeof row === 'object' ? { id: row.id, name: row.name, patchId: row.patchId } : row);
              return /llm-pi-ai|dsh-llm/.test(blob);
            })
            .slice(0, 5)
            .map((row) => ({ id: row.id, name: row.name, patchId: row.patchId }));
        }
        let models = 0;
        try {
          models = (await fetchProviderModels()).length;
        } catch {
          models = -1;
        }
        return { ok: true, patchFile: file || '(DSH_PROFILE_DIR unset)', shape, gatewayModels: models };
      }
      if (action === 'credential') return await ensureProviderCredential();
      return await ensureProvider();
    },
  });
  tool({
    name: 'wb2api_bulk',
    description: '对全部账号批量执行网关日常任务：checkin 签到 / balance 刷新余额 / travel 旅行 / activity 活跃 / keepalive 保活。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['checkin', 'balance', 'travel', 'activity', 'keepalive'] },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async execute(args) {
      const kind = args && args.kind;
      const path = { checkin: 'checkin_all', balance: 'balance_all', travel: 'travel_all', activity: 'activity_all', keepalive: 'keepalive_all' }[kind];
      if (!path) return { ok: false, error: `unknown kind: ${kind}` };
      const res = await callPanel(`/panel/api/${path}`, { method: 'POST', body: '{}', timeoutMs: 180000 });
      return { ok: res.ok, status: res.status, result: res.data, error: res.error };
    },
  });

  tool({
    name: 'wb2api_login',
    description:
      '新增 WorkBuddy 账号的登录流程：action=start 取授权链接（realm=cn|global），action=poll 用返回的 state 轮询结果（done=true 时账号热加载进池），action=regions 列出 global 可选地区。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'poll', 'regions'] },
        realm: { type: 'string', enum: ['cn', 'global'], description: 'start 时使用，默认 cn' },
        state: { type: 'string', description: 'poll 时必填，来自 start 的返回' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      const action = (args && args.action) || 'regions';
      if (action === 'start') {
        const realm = (args && args.realm) === 'global' ? 'global' : 'cn';
        const res = await callPanel('/panel/api/login/start', {
          method: 'POST',
          body: JSON.stringify({ realm }),
          timeoutMs: 60000,
        });
        return { ok: res.ok, status: res.status, login: res.data, error: res.error };
      }
      if (action === 'poll') {
        if (!args || !args.state) return { ok: false, error: 'state is required' };
        const res = await callPanel(`/panel/api/login/poll?state=${encodeURIComponent(args.state)}`, {
          timeoutMs: 60000,
        });
        return { ok: res.ok, status: res.status, poll: res.data, error: res.error };
      }
      const res = await callPanel('/panel/api/login/regions');
      return { ok: res.ok, regions: res.data && res.data.regions, error: res.error };
    },
  });

  tool({
    name: 'wb2api_tasks',
    description:
      '任务中心：queue 查队列状态，scan 扫描全部账号的可做任务，run 启动队列执行（growth 领成长奖励），account 列出某账号任务，accept / accept_all 接受任务，claim 领取单个奖励，auto / auto_all 自动处理。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['queue', 'scan', 'run', 'account', 'accept', 'accept_all', 'claim', 'auto', 'auto_all'],
        },
        uid: { type: 'string', description: 'account / accept / accept_all / claim / auto / auto_all 时必填' },
        task_codes: { type: 'array', items: { type: 'string' }, description: 'accept 时的任务码列表' },
        task_code: { type: 'string', description: 'claim 时的单个任务码' },
        concurrency: { type: 'number', description: 'run 时并发数，默认 2' },
        growth: { type: 'boolean', description: 'run 时是否执行成长奖励，默认 true' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      const action = (args && args.action) || 'queue';
      const uid = args && args.uid ? encodeURIComponent(String(args.uid)) : '';
      const needUid = ['account', 'accept', 'accept_all', 'claim', 'auto', 'auto_all'];
      if (needUid.includes(action) && !uid) return { ok: false, error: 'uid is required' };

      if (action === 'queue') {
        const res = await callPanel('/panel/api/tasks/queue');
        return { ok: res.ok, queue: res.data, error: res.error };
      }
      if (action === 'scan') {
        const res = await callPanel('/panel/api/tasks/scan_all', {
          method: 'POST',
          body: '{}',
          timeoutMs: 180000,
        });
        return { ok: res.ok, status: res.status, scan: res.data, error: res.error };
      }
      if (action === 'run') {
        const concurrency = Math.min(Math.max(Number((args && args.concurrency) || 2), 1), 8);
        const growth = !(args && args.growth === false);
        const res = await callPanel('/panel/api/tasks/run_queue', {
          method: 'POST',
          body: JSON.stringify({ concurrency, growth }),
          timeoutMs: 60000,
        });
        return { ok: res.ok, started: res.data, error: res.error };
      }
      if (action === 'account') {
        const res = await callPanel(`/panel/api/accounts/${uid}/tasks`, { timeoutMs: 60000 });
        return { ok: res.ok, tasks: res.data && res.data.tasks, error: res.error };
      }
      if (action === 'accept') {
        const codes = Array.isArray(args && args.task_codes) ? args.task_codes : [];
        if (!codes.length) return { ok: false, error: 'task_codes is required' };
        const res = await callPanel(`/panel/api/accounts/${uid}/tasks/accept`, {
          method: 'POST',
          body: JSON.stringify({ task_codes: codes }),
          timeoutMs: 60000,
        });
        return { ok: res.ok, result: res.data, error: res.error };
      }
      if (action === 'claim') {
        if (!args || !args.task_code) return { ok: false, error: 'task_code is required' };
        const res = await callPanel(`/panel/api/accounts/${uid}/tasks/claim`, {
          method: 'POST',
          body: JSON.stringify({ task_code: args.task_code }),
          timeoutMs: 60000,
        });
        return { ok: res.ok, result: res.data, error: res.error };
      }
      if (action === 'auto') {
        const res = await callPanel(`/panel/api/accounts/${uid}/tasks/auto`, {
          method: 'POST',
          body: '{}',
          timeoutMs: 180000,
        });
        return { ok: res.ok, result: res.data, error: res.error };
      }
      if (action === 'auto_all') {
        const res = await callPanel(`/panel/api/accounts/${uid}/tasks/auto_all`, {
          method: 'POST',
          body: '{}',
          timeoutMs: 180000,
        });
        return { ok: res.ok, result: res.data, error: res.error };
      }
      const res = await callPanel(`/panel/api/accounts/${uid}/tasks/accept_all`, {
        method: 'POST',
        body: '{}',
        timeoutMs: 60000,
      });
      return { ok: res.ok, result: res.data, error: res.error };
    },
  });

  tool({
    name: 'wb2api_diagnostics',
    description:
      '网关诊断数据：metrics 请求指标与归档状态，requests 最近请求日志，packages 账号订阅包余量，vouchers 学校/优惠券，probes 模型探测结果。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['metrics', 'requests', 'packages', 'vouchers', 'probes'] },
        limit: { type: 'number', description: 'requests 时返回条数，默认 50' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async execute(args) {
      const kind = (args && args.kind) || 'metrics';
      const map = {
        metrics: '/panel/api/request_metrics',
        requests: `/panel/api/request_logs?limit=${Math.min(Math.max(Number((args && args.limit) || 50), 1), 500)}`,
        packages: '/panel/api/packages',
        vouchers: '/panel/api/school/vouchers',
        probes: '/panel/api/model_probes',
      };
      const path = map[kind];
      if (!path) return { ok: false, error: `unknown kind: ${kind}` };
      const res = await callPanel(path, { timeoutMs: 90000 });
      return { ok: res.ok, status: res.status, data: res.data, error: res.error };
    },
  });

  tool({
    name: 'wb2api_clientkeys',
    description:
      '网关客户端 key 管理（需要新版二进制）：读取当前 client key 列表。当前实例不支持时返回 404 说明。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const res = await callPanel('/panel/api/clientkeys');
      return { ok: res.ok, status: res.status, data: res.data, error: res.error };
    },
  });

  tool({
    name: 'wb2api_security',
    description: '安全与流量统计页（需要新版二进制）：请求总数、来源分布与 token 合计。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const res = await callPanel('/panel/api/security');
      return { ok: res.ok, status: res.status, data: res.data, error: res.error };
    },
  });

  // ------------------------------------------------------- provider injection
  //
  // 把本机网关注入成 DSH 的一个模型提供商（profile 的 llm-pi-ai.providers.wb2api）。
  //
  // 为什么走 llm-pi-ai 而不是自己写 adapter：
  //   1) 网关本身就是 OpenAI 兼容协议，llm-pi-ai 的 api: openai-completions 直接能连；
  //   2) apiKeyEnv 是「credential reference」，凭据库里的值优先于环境变量，
  //      所以 key 由 credentials.set() 写进凭据库即可，配置文件里不出现明文；
  //   3) 自己实现 LlmAdapter 要重做 tool-call 流式拼装 / reasoning delta / usage /
  //      finish 映射 / 错误码归一，且随 DSH 内部契约漂移，收益为负。
  //
  // 幂等：已存在 wb2api 段就跳过。可关：config.injectProvider = false。

  const PROVIDER_ID = 'wb2api';
  // 本插件的包名：用于从 node_modules 布局反推 profile 目录。
  const PKG_NAME = 'dsh-wb2api-panel';
  const PROVIDER_KEY_REF = 'WB2API_API_KEY';

  function profilePatchPath() {
    const dir = process.env.DSH_PROFILE_DIR;
    return dir ? path.join(dir, 'cordis.patch.yml') : '';
  }

  // 注入结果要能被 UI / agent 看见：冷启动时网关可能还没监听，
  // 单次尝试失败会让用户看到「插件装了但模型列表里没有 wb2api」而无从排查。
  const injectState = { credential: null, provider: null, checkedAt: 0 };

  /**
   * 等网关就绪：health 通过 + /v1/models 真的返回了模型。
   * 冷启动（进程刚拉起 / 首次加载账号池）时 2s 常常不够，所以退避轮询。
   * 等待期间不抛错，超时返回 [] 让调用方降级。
   */
  async function waitForGatewayReady(timeoutMs = 24000, intervalMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    let lastReason = 'gateway not reachable';
    for (;;) {
      const probe = await health();
      if (probe.running) {
        const models = await fetchProviderModels();
        if (models.length) return { models, waited: timeoutMs - (deadline - Date.now()) };
        lastReason = 'gateway reachable but advertised no models';
      } else {
        lastReason = 'gateway not listening on ' + baseUrl();
      }
      if (Date.now() >= deadline) return { models: [], reason: lastReason };
      await sleep(intervalMs);
    }
  }
  /** 从网关 /v1/models 取模型目录，转成 llm-pi-ai 的 models[] 形状。 */
  async function fetchProviderModels() {
    const res = await callPanel('/v1/models', { timeoutMs: 30000 });
    const list = (res && res.ok && res.data && Array.isArray(res.data.data)) ? res.data.data : [];
    return list.map((model) => {
      const entry = { id: String(model.id) };
      if (model.name) entry.name = String(model.name);
      const ctxLen = Number(model.context_length || model.context_window);
      if (Number.isFinite(ctxLen) && ctxLen > 0) entry.contextWindow = Math.trunc(ctxLen);
      const maxOut = Number(model.max_output_tokens || model.max_tokens);
      if (Number.isFinite(maxOut) && maxOut > 0) entry.maxTokens = Math.trunc(maxOut);

      // 档位（reasoning efforts）：不注入这里，模型选择器就只有「默认」一档，
      // 等于把网关支持的 low/high/max 全吞掉了。
      // 两个端点字段名不同：/v1/models 用 reasoning_supported_efforts，
      // /panel/api/models 用 supported_efforts。两个都认。
      const effortsList = model.reasoning_supported_efforts || model.supported_efforts;
      if (model.supports_reasoning === false) {
        entry.reasoningEfforts = false;
      } else if (Array.isArray(effortsList) && effortsList.length) {
        const efforts = {};
        for (const effort of effortsList) {
          if (typeof effort === 'string' && effort) efforts[effort] = effort;
        }
        if (Object.keys(efforts).length) entry.reasoningEfforts = efforts;
      }
      return entry;
    });
  }

  function yamlProviderBlock(models, base = 6) {
    // 缩进必须由调用方给定（由文件里 providers: 的实际层级推算），写死会套错层级。
    const pad = (n) => ' '.repeat(n);
    const key = pad(base);
    const field = pad(base + 2);
    const item = pad(base + 4);
    const deep = pad(base + 6);
    const lines = [
      `${key}${PROVIDER_ID}:`,
      `${field}displayName: WorkBuddy 网关`,
      `${field}api: openai-completions`,
      `${field}baseURL: ${baseUrl()}/v1`,
      `${field}apiKeyEnv: ${PROVIDER_KEY_REF}`,
      `${field}defaultInput:`,
      `${item}- text`,
      `${item}- image`,
      `${field}compat:`,
      `${item}supportsReasoningEffort: true`,
      `${field}models:`,
    ];
    for (const model of models) {
      lines.push(`${item}- id: ${JSON.stringify(model.id)}`);
      if (model.name) lines.push(`${deep}name: ${JSON.stringify(model.name)}`);
      if (model.contextWindow) lines.push(`${deep}contextWindow: ${model.contextWindow}`);
      if (model.maxTokens) lines.push(`${deep}maxTokens: ${model.maxTokens}`);
      lines.push(`${deep}input: [text, image]`);
      // 档位必须一起写：漏了它模型选择器就只剩「默认」，等于把 low/high/max 吞掉。
      if (model.reasoningEfforts === false) {
        lines.push(`${deep}reasoningEfforts: false`);
      } else if (model.reasoningEfforts && typeof model.reasoningEfforts === 'object') {
        lines.push(`${deep}reasoningEfforts:`);
        for (const [effort, label] of Object.entries(model.reasoningEfforts)) {
          lines.push(`${deep}  ${effort}: ${label}`);
        }
      }
    }
    return lines.join('\n');
  }

  /** 从自身安装位置反推 profile 目录：node_modules/<pkg> 的真实路径与 HERE 比对。 */
  function selfProfileDir() {
    // 1) 首选：从安装路径直接反推 <profile>/node_modules/<pkg>。
    //    不依赖 homedir 与环境变量——真实目录安装、junction 安装都成立。
    //    （上一版只靠扫 ~/.dsh/profiles，从 GitHub 装成真实目录后直接返回空，注入链路整条死掉。）
    const parent = path.dirname(HERE);
    if (path.basename(parent).toLowerCase() === 'node_modules') {
      return path.dirname(parent);
    }
    // 2) 环境变量：Host 进程内一般没有，但 shell 里跑测试时有。
    const fromEnv = String(process.env.DSH_PROFILE_DIR || '').trim();
    if (fromEnv && existsSync(path.join(fromEnv, 'cordis.patch.yml'))) return fromEnv;
    // 3) 扫 ~/.dsh/profiles，用真实路径比对（junction 安装时 HERE 指向源码目录）。
    const base = path.join(os.homedir(), '.dsh', 'profiles');
    let names = [];
    try {
      names = readdirSync(base);
    } catch {
      return '';
    }
    let selfReal = HERE;
    try {
      selfReal = realpathSync(HERE);
    } catch {
      /* 保持原值 */
    }
    const candidates = [];
    for (const name of names) {
      const dir = path.join(base, name);
      if (!existsSync(path.join(dir, 'cordis.patch.yml'))) continue;
      candidates.push(dir);
      try {
        const installed = realpathSync(path.join(dir, 'node_modules', PKG_NAME));
        if (installed === selfReal || installed === HERE) return dir;
      } catch {
        /* 这个 profile 没装本插件 */
      }
    }
    // 退化：只有一个 profile 时直接用它（单 profile 安装的常见情形）。
    return candidates.length === 1 ? candidates[0] : '';
  }

  /**
   * 直接改写 profile patch 里的 providers.wb2api 段。
   *
   * 为什么需要它：宿主把「插件装载 / 热更新」整体包在 HMR 事务里，
   * 从插件 fiber 里调用 configEditor.edit 必然抛 "HMR transactions cannot be nested"，
   * 与重试多久无关。文件层写入绕开这条限制，Loader 对账后同样生效，
   * 且下次冷启动一定带上这段配置。
   */
  function readPatchFileProvider() {
    const dir = selfProfileDir();
    if (!dir) return { found: false, reason: 'profile directory not found' };
    const file = path.join(dir, 'cordis.patch.yml');
    let rows = [];
    try {
      rows = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    } catch (error) {
      return { found: false, reason: 'read failed: ' + String((error && error.message) || error) };
    }
    const rowStart = rows.findIndex((line) => /^- id: llm-pi-ai\s*$/.test(line));
    if (rowStart < 0) return { found: false, file };
    let rowEnd = rows.length;
    for (let i = rowStart + 1; i < rows.length; i += 1) {
      if (/^\S/.test(rows[i]) && rows[i].trim()) {
        rowEnd = i;
        break;
      }
    }
    let providerAt = -1;
    for (let i = rowStart; i < rowEnd; i += 1) {
      if (/^\s+wb2api:\s*$/.test(rows[i])) {
        providerAt = i;
        break;
      }
    }
    if (providerAt < 0) return { found: false, file };
    const indent = rows[providerAt].length - rows[providerAt].trimStart().length;
    let count = 0;
    for (let i = providerAt + 1; i < rowEnd; i += 1) {
      const trimmed = rows[i].trim();
      if (!trimmed) continue;
      const childIndent = rows[i].length - rows[i].trimStart().length;
      if (childIndent <= indent) break;
      if (/^-\s+id:/.test(trimmed)) count += 1;
    }
    return { found: true, file, count };
  }

  function upsertProviderBlock(models) {
    const dir = selfProfileDir();
    if (!dir) return { ok: false, reason: 'profile directory not found' };
    const file = path.join(dir, 'cordis.patch.yml');
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      return { ok: false, reason: 'read failed: ' + String((error && error.message) || error) };
    }
    const rows = text.replace(/\r\n/g, '\n').split('\n');
    const rowStart = rows.findIndex((line) => /^- id: llm-pi-ai\s*$/.test(line));
    if (rowStart < 0) return { ok: false, reason: 'llm-pi-ai row not found in ' + file };
    let rowEnd = rows.length;
    for (let i = rowStart + 1; i < rows.length; i += 1) {
      if (/^\S/.test(rows[i]) && rows[i].trim()) {
        rowEnd = i;
        break;
      }
    }
    // yamlProviderBlock 产出的 wb2api 段是 6 空格基准；挂到 providers: 之下必须再缩 2 格，
    // 否则 wb2api 会变成 providers 的同级键，配置直接失效（providers 变成 null）。
    // 缩进一律从文件里算：profile 的 config: 在 2 格、providers: 在 4 格、提供商键在 6 格。
    // 写死任一层级都会把 wb2api 套到错误的父键下（表现为 providers 里多了个 providers）。
    const indentOf = (index) => rows[index].length - rows[index].trimStart().length;

    let providersAt = -1;
    for (let i = rowStart; i < rowEnd; i += 1) {
      if (/^\s*providers:\s*$/.test(rows[i])) {
        providersAt = i;
        break;
      }
    }

    if (providersAt < 0) {
      let configIndent = 2;
      for (let i = rowStart; i < rowEnd; i += 1) {
        if (/^\s*config:\s*$/.test(rows[i])) {
          configIndent = indentOf(i);
          break;
        }
      }
      const providersIndent = configIndent + 2;
      const created = [
        ...rows.slice(0, rowEnd),
        ' '.repeat(providersIndent) + 'providers:',
        ...yamlProviderBlock(models, providersIndent + 2).split('\n'),
        ...rows.slice(rowEnd),
      ];
      try {
        writeFileSync(file, created.join('\r\n'), 'utf8');
      } catch (error) {
        return { ok: false, reason: 'write failed: ' + String((error && error.message) || error) };
      }
      return { ok: true, file, models: models.length, created: true };
    }

    const blockLines = yamlProviderBlock(models, indentOf(providersAt) + 2).split('\n');

    // 收集 providers 之下所有 wb2api 段：缩进无关，重复段必须能识别并清掉，
    // 否则「写文件 → 对账 → 重载 → 再写」会自我循环，段越写越多。
    const spans = [];
    for (let i = providersAt + 1; i < rowEnd; i += 1) {
      const match = /^(\s+)wb2api:\s*$/.exec(rows[i]);
      if (!match) continue;
      const indent = match[1].length;
      let end = rowEnd;
      for (let j = i + 1; j < rowEnd; j += 1) {
        const trimmed = rows[j].trim();
        if (!trimmed) continue;
        const childIndent = rows[j].length - rows[j].trimStart().length;
        if (childIndent <= indent) {
          end = j;
          break;
        }
      }
      spans.push({ start: i, end });
      i = end - 1;
    }

    if (spans.length === 1) {
      const current = rows.slice(spans[0].start, spans[0].end).join('\n');
      if (current === blockLines.join('\n')) {
        return { ok: true, already: true, file, models: models.length };
      }
    }

    let working = rows.slice();
    for (let k = spans.length - 1; k >= 0; k -= 1) {
      working = [...working.slice(0, spans[k].start), ...working.slice(spans[k].end)];
    }
    const insertAt = providersAt + 1;
    const next = [...working.slice(0, insertAt), ...blockLines, ...working.slice(insertAt)];
    try {
      writeFileSync(file, next.join('\r\n'), 'utf8');
    } catch (error) {
      return { ok: false, reason: 'write failed: ' + String((error && error.message) || error) };
    }
    return { ok: true, file, models: models.length, replaced: spans.length };
  }

  /** 找到 llm-pi-ai 的 profile 行（configEditor 是官方入口，不依赖环境变量/文件路径）。 */
  function findLlmEntry(editor) {
    if (!editor || typeof editor.entries !== 'function') return null;
    const rows = editor.entries() || [];
    // Entry.id 是 Loader 全 id（include:llm-pi-ai），没有 name/patchId 字段可依赖。
    return rows.find((row) => row && typeof row.id === 'string' && /(^|:)llm-pi-ai$/.test(row.id)) || null;
  }

  /** 当前该行的有效配置（inherited 打底，override 覆盖）。 */
  function currentEntryConfig(editor, entry) {
    try {
      const rows = (typeof editor.configuration === 'function' && editor.configuration()) || [];
      const hit = rows.find((row) => row && row.entry && (row.entry === entry || row.entry.id === entry.id));
      if (hit) return { ...(hit.inherited || {}), ...(hit.override || {}) };
    } catch {
      /* 退回只读 override */
    }
    const raw = (entry && entry.config) || {};
    return { ...raw };
  }

  function remember(kind, result) {
    injectState[kind] = result;
    injectState.checkedAt = Date.now();
    return result;
  }

  async function ensureProvider() {
    return remember('provider', await ensureProviderInner());
  }

  async function ensureProviderInner() {
    const editor = ctx.get('configEditor');
    if (!editor || typeof editor.edit !== 'function') {
      return { ok: false, reason: 'configEditor service unavailable' };
    }
    const entry = findLlmEntry(editor);
    if (!entry) {
      return {
        ok: false,
        code: 'LLM_PI_AI_MISSING',
        reason:
          'profile 里没有 llm-pi-ai 行，无法注册模型提供商。' +
          '请在 Harness「插件」页启用 llm-pi-ai（它自带 openai-completions 适配器），' +
          '或在 profile 的 cordis.patch.yml 里加 include:llm-pi-ai 后重载插件。' +
          '网关本体不受影响，面板与工具仍可用。',
      };
    }

    const withProviders = (base) => (base && typeof base.providers === 'object' && base.providers) || {};
    const existing = withProviders(currentEntryConfig(editor, entry))[PROVIDER_ID];
    if (existing) {
      // 已注入过：只有当网关模型带档位、而现有条目没有时才重建（补漏洞）。
      const stale = (existing.models || []).some((m) => m && m.reasoningEfforts === undefined);
      if (!stale) return { ok: true, already: true, entryId: entry.id };
    }

    // 先等网关就绪再取模型：冷启动竞态下这是「装了但没模型」的主因。
    const ready = await waitForGatewayReady();
    const models = ready.models;
    if (!models.length) {
      return { ok: false, reason: 'gateway not ready: ' + (ready.reason || 'unknown') };
    }

    // 文件层短路：写 profile patch 会触发宿主对账 → 插件重载 → 再次进入这里，
    // 少了这一步就会自我循环、把段越写越多。文件里已有同样规模的段就直接认账。
    const onDisk = readPatchFileProvider();
    if (onDisk.found && onDisk.count === models.length) {
      return { ok: true, already: true, viaFile: true, file: onDisk.file, injected: onDisk.count };
    }

    const profile = {
      displayName: 'WorkBuddy 网关',
      api: 'openai-completions',
      baseURL: baseUrl() + '/v1',
      apiKeyEnv: PROVIDER_KEY_REF,
      defaultInput: ['text', 'image'],
      compat: { supportsReasoningEffort: true },
      models,
    };

    // configEditor.edit 在 HMR 事务里会抛 "HMR transactions cannot be nested"：
    // 插件刚热更新完那一下正好落在事务窗口内。这不是配置错误，等一拍重试即可。
    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await editor.edit(entry, (current, inherited) => {
          const merged = { ...(inherited || {}), ...(current || {}) };
          const providers = { ...withProviders(merged), [PROVIDER_ID]: profile };
          return { ...(current || {}), providers };
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const message = String((error && error.message) || error);
        if (!/HMR/i.test(message)) break;
        await sleep(1500);
      }
    }
    if (lastError) {
      const message = String((lastError && lastError.message) || lastError);
      // HMR 事务限制：configEditor 不可用时改走文件层，别把自动配置整条断掉。
      if (/HMR transactions/.test(message)) {
        const viaFile = upsertProviderBlock(models);
        if (viaFile.ok) {
          return {
            ok: true,
            injected: models.length,
            viaFile: true,
            file: viaFile.file,
            entryId: entry.id,
            note: 'configEditor 被 HMR 事务挡住，已直接写入 profile patch（Loader 对账后生效）',
          };
        }
        return { ok: false, reason: message + ' / file fallback failed: ' + viaFile.reason };
      }
      return { ok: false, reason: 'edit failed: ' + message };
    }

    const after = findLlmEntry(ctx.get('configEditor'));
    const landed = Boolean(after && withProviders(currentEntryConfig(ctx.get('configEditor'), after))[PROVIDER_ID]);
    return { ok: landed, injected: landed ? models.length : 0, entryId: entry.id, verified: landed };
  }

  /** key 写进凭据库：apiKeyEnv 解析时优先于环境变量，配置文件里不落明文。 */
  async function ensureProviderCredential() {
    return remember('credential', await ensureProviderCredentialInner());
  }

  async function ensureProviderCredentialInner() {
    const store = ctx.get('credentials');
    const key = apiKey();
    if (!store || typeof store.set !== 'function' || !key) {
      return { ok: false, reason: store ? 'no api key' : 'credentials service unavailable' };
    }
    try {
      const info = await store.describe(PROVIDER_KEY_REF);
      let current = null;
      try {
        const resolved = await store.resolve(PROVIDER_KEY_REF);
        current = resolved && resolved.value ? resolved.value : null;
      } catch {
        current = null;
      }
      // 「已配置」不等于「配置对了」：DSH 侧报 AUTH 时最常见的就是存了旧 key。
      if (current === key) return { ok: true, already: true, writable: info && info.writable };
      await store.set(PROVIDER_KEY_REF, key);
      return { ok: true, stored: true, replaced: Boolean(current) };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }
  // ---------------------------------------------------------------- lifecycle
  //
  // 与 Harness 同生共死（可用 config 关掉）：
  //   autoStart   插件装载时若网关没在跑就拉起来（幂等，已在跑就跳过）
  //   stopOnUnload 插件卸载时把网关停掉
  //
  // 注意：只覆盖「正常装载/卸载」。Harness 被强杀时 Node 不会执行 dispose，
  // 网关会变成孤儿进程——这一点靠插件无法兜住，需要宿主侧的父进程监护。
  if (cfg.injectProvider !== false) {
    // 宿主把「插件装载/热更新」整体包在 HMR 事务里，此时调用 configEditor.edit
    // 会抛 "HMR transactions cannot be nested"。工具调用不受影响（不同 fiber），
    // 所以自动注入必须换时机：等事务收尾（事件）并持续重试直到成功。
    let injectTries = 0;
    let injectDone = false;

    const attemptInject = async (why) => {
      if (injectDone) return;
      injectTries += 1;
      try {
        await ensureProviderCredential();
        const result = await ensureProvider();
        injectState.tries = injectTries;
        injectState.lastWhy = why;
        if (result.ok) {
          injectDone = true;
          console.error('[wb2api-panel] provider ready via ' + why + ' (try ' + injectTries + ')');
        } else if (!/HMR transactions/.test(String(result.reason || ''))) {
          // 非事务类失败（真配置错误 / 网关没模型）先记下，重试仍会继续兜底。
          console.error('[wb2api-panel] provider injection failed via ' + why + ': ' + result.reason);
        }
      } catch (error) {
        console.error('[wb2api-panel] provider injection error:', error);
      }
    };

    const timer2 = setTimeout(() => attemptInject('initial'), 2200);
    if (timer2 && typeof timer2.unref === 'function') timer2.unref();
    ctx.effect(() => () => clearTimeout(timer2), 'wb2api-panel provider timer');

    // 事务收尾信号：这两个事件都在 Loader 对账/模块替换完成之后才发。
    const onReload = () => {
      const timer = setTimeout(() => attemptInject('reload-event'), 600);
      if (timer && typeof timer.unref === 'function') timer.unref();
    };
    for (const eventName of ['app-boot/config-reload', 'hmr/reload']) {
      try {
        ctx.on(eventName, onReload);
      } catch {
        /* 事件不可用时靠下面的轮询兜底 */
      }
    }

    // 轮询兜底：每 4s 试一次，最多 30 次（约 2 分钟）。
    // 期间若注入成功就自我停止；插件卸载时由 effect 清掉。
    const retryTimer = setInterval(() => {
      if (injectDone || injectTries >= 30) {
        clearInterval(retryTimer);
        return;
      }
      attemptInject('retry');
    }, 4000);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
    ctx.effect(() => () => clearInterval(retryTimer), 'wb2api-panel provider retry loop');
  }  if (cfg.autoStart !== false) {
    const timer = setTimeout(async () => {
      try {
        const probe = await health();
        if (!probe.running) {
          const started = await start();
          if (!started.ok) {
            // 没有 panelDir / exe 不是错误：远程网关模式本来就不该起本地进程。
            if (started.error && !/not found|unset/.test(started.error)) {
              console.error('[wb2api-panel] autoStart failed:', started.error);
            }
          }
        }
      } catch (error) {
        console.error('[wb2api-panel] autoStart error:', error);
      }
    }, 1200);
    if (timer && typeof timer.unref === 'function') timer.unref();
    ctx.effect(() => () => clearTimeout(timer), 'wb2api-panel autostart timer');
  }

  if (cfg.stopOnUnload !== false) {
    ctx.effect(
      () => () => {
        Promise.resolve()
          .then(() => stop())
          .catch(() => {});
      },
      'wb2api-panel stop on unload',
    );
  }
  // Process supervision is user-controlled: unloading the plugin never kills the gateway.
  ctx.effect(() => () => {
    state.child = null;
  }, 'wb2api-panel state');
}
