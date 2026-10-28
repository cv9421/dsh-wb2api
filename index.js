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
import { readFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export const name = 'wb2api-panel';
export const inject = ['tools'];

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:7863',
  apiKey: '',
  panelDir: '',
  exe: 'wb2api.exe',
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
  const panelDir = () => (cfg.panelDir ? path.resolve(String(cfg.panelDir)) : '');
  const exePath = () => (panelDir() ? path.join(panelDir(), cfg.exe || DEFAULTS.exe) : '');

  /** api_key: explicit config wins, otherwise read the gateway's own config.json. */
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
    const key = apiKey();
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
      return { ok: res.ok, status: res.status, data };
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
    const pids = new Set([readPidFile(), state.child].filter(Boolean));
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
      apiConfigured: Boolean(apiKey()),
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
  const register = (route) => {
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function') return;
    routes.push(webServer.register(route));
  };

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
          body: JSON.stringify({ id: args.id, disabled: args.enabled === false }),
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
      const gateSupported = Boolean(cfg && cfg.models && Array.isArray(cfg.models.disabled));
      const disabledList = gateSupported ? cfg.models.disabled : [];
      return {
        ok: true,
        count: models.length,
        gateSupported,
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
          disabled: gateSupported ? disabledList.includes(model.id) : null,
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

  // Process supervision is user-controlled: unloading the plugin never kills the gateway.
  ctx.effect(() => () => {
    state.child = null;
  }, 'wb2api-panel state');
}
