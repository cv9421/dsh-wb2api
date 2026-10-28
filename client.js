/**
 * Client half of the WorkBuddy2API gateway bundle.
 *
 * Renders a native Harness settings page (settings.section) that reads the
 * gateway through the Host half's same-origin `/wb2api` surface. No iframe: the
 * page lives in the Harness render tree, so theme tokens and locale apply.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wb2api-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---------------------------------------------------------------- i18n

    const ZH = {
      section: 'WorkBuddy 网关',
      overview: '概览',
      accounts: '账号',
      login: '登录',
      tasks: '任务',
      models: '模型',
      usage: '用量',
      diagnostics: '诊断',
      logs: '日志',
      refresh: '刷新',
      start: '启动',
      stop: '停止',
      restart: '重启',
      checkin: '签到',
      balance: '余额',
      pause: '暂停',
      resume: '恢复',
      revive: '复活',
      disable: '禁用',
      travel: '旅行',
      activity: '活跃',
      keepalive: '保活',
      service: '服务',
      reachable: '已连接',
      unreachable: '未连接',
      version: '版本',
      uptime: '运行时长',
      total: '账号总数',
      healthy: '健康',
      cooling: '冷却中',
      disabled: '已禁用',
      paused: '已暂停',
      inFlight: '并发已满',
      redis: 'Redis',
      sticky: '粘性会话',
      account: '账号',
      credits: '积分',
      used: '已用',
      requests: '请求数',
      tokens: 'Tokens',
      lastUsed: '最近使用',
      state: '状态',
      realm: '区服',
      modelId: '模型',
      rate: '倍率',
      context: '上下文',
      maxOutput: '最大输出',
      enabled: '已启用',
      blocked: '已禁用',
      loading: '加载中…',
      empty: '暂无数据',
      search: '搜索模型…',
      unreachableHint: '无法连接 wb2api 服务，先启动服务或检查地址。',
      usageTotals: '用量合计',
      avgLatency: '平均延迟',
      successRate: '成功率',
      runtimeLogs: '运行日志',
      panelLogs: '面板日志',
      errors: '错误数',
      pid: '进程',
      baseUrl: '地址',
      noKey: '未读到 api_key',
      noPanelDir: '未配置面板目录：只能看数据，无法托管进程（请在 cordis.patch.yml 设 panelDir 或设 WB2API_PANEL_DIR）',
  providerBroken: '模型提供商未注册',
  noKeyHint: '没有读到 api_key：面板目录没找到或 config.json 缺字段。请设 apiKey，或设 WB2API_PANEL_DIR / WB2API_KEY。',
  staleCode: '插件文件已更新，但当前运行的仍是旧代码——请完全退出并重启 DSH（disable/enable 不会重载模块）。',
  providerNoAdapter: '缺少 llm-pi-ai',
      loginRealm: '登录区服',
      loginCn: '国内版（cn）',
      loginGlobal: '国际版（global）',
      loginStart: '生成授权链接',
      loginOpen: '打开授权页并完成登录',
      loginWaiting: '等待授权…',
      loginDone: '登录成功',
      loginIdle: '选择区服后生成授权链接，登录完成后账号会自动加入池中。',
      loginRegions: '国际版可选地区',
      cancel: '取消',
      tasksQueue: '队列',
      tasksScan: '扫描全部任务',
      tasksRun: '运行队列',
      tasksAccount: '单账号任务',
      concurrency: '并发',
      growth: '领成长奖励',
      queueIdle: '队列未运行',
      queueRunning: '队列运行中',
      progress: '进度',
      reward: '奖励',
      accept: '接受',
      acceptAll: '全部接受',
      claim: '领取',
      claimed: '已领取',
      claimable: '可领取',
      auto: '自动处理',
      autoAll: '自动处理全部',
      pendingCount: '待处理',
      scanResult: '扫描结果',
      groupBy: '分组',
      metrics: '请求指标',
      completed: '已完成',
      succeeded: '成功',
      failed: '失败',
      inFlightNow: '进行中',
      archive: '归档',
      requestLogs: '请求日志',
      packages: '订阅包',
      vouchers: '券',
      probes: '模型探测',
      remain: '剩余',
      size: '总量',
      notSupported: '当前二进制版本不支持该端点（升级 wb2api 后可用）',
      gateUnsupported: '当前二进制没有逐模型准入开关（升级 wb2api 后可用），此处只读展示模型清单',
      gateHidden: '本版本用 config.models.hidden 控制模型隐藏（面板只读，改配置后热生效）',
      section_logs: '日志',
    };

    const EN = {
      section: 'WorkBuddy Gateway',
      overview: 'Overview',
      accounts: 'Accounts',
      login: 'Sign in',
      tasks: 'Tasks',
      models: 'Models',
      usage: 'Usage',
      diagnostics: 'Diagnostics',
      logs: 'Logs',
      refresh: 'Refresh',
      start: 'Start',
      stop: 'Stop',
      restart: 'Restart',
      checkin: 'Check in',
      balance: 'Balance',
      pause: 'Pause',
      resume: 'Resume',
      revive: 'Revive',
      disable: 'Disable',
      travel: 'Travel',
      activity: 'Activity',
      keepalive: 'Keep-alive',
      service: 'Service',
      reachable: 'Connected',
      unreachable: 'Disconnected',
      version: 'Version',
      uptime: 'Uptime',
      total: 'Accounts',
      healthy: 'Healthy',
      cooling: 'Cooling',
      disabled: 'Disabled',
      paused: 'Paused',
      inFlight: 'In-flight full',
      redis: 'Redis',
      sticky: 'Sticky sessions',
      account: 'Account',
      credits: 'Credits',
      used: 'Used',
      requests: 'Requests',
      tokens: 'Tokens',
      lastUsed: 'Last used',
      state: 'State',
      realm: 'Realm',
      modelId: 'Model',
      rate: 'Rate',
      context: 'Context',
      maxOutput: 'Max output',
      enabled: 'Enabled',
      blocked: 'Blocked',
      loading: 'Loading…',
      empty: 'No data',
      search: 'Search models…',
      unreachableHint: 'Cannot reach the wb2api service. Start it or check the base URL.',
      usageTotals: 'Usage totals',
      avgLatency: 'Avg latency',
      successRate: 'Success rate',
      runtimeLogs: 'Runtime log',
      panelLogs: 'Panel log',
      errors: 'Errors',
      pid: 'Process',
      baseUrl: 'Base URL',
      noKey: 'api_key not found',
      noPanelDir: 'No panel directory: read-only. Set panelDir in cordis.patch.yml or WB2API_PANEL_DIR.',
  providerBroken: 'Model provider not registered',
  noKeyHint: 'No api_key resolved: panel directory not found or config.json lacks the field. Set apiKey, WB2API_PANEL_DIR, or WB2API_KEY.',
  staleCode: 'Plugin files changed on disk but the old code is still running — fully quit and restart DSH (disable/enable does not reload modules).',
  providerNoAdapter: 'llm-pi-ai missing',
      loginRealm: 'Realm',
      loginCn: 'China (cn)',
      loginGlobal: 'Global (global)',
      loginStart: 'Create authorization link',
      loginOpen: 'Open the authorization page and finish signing in',
      loginWaiting: 'Waiting for authorization…',
      loginDone: 'Signed in',
      loginIdle: 'Pick a realm, create the link, and the account joins the pool as soon as you finish.',
      loginRegions: 'Global regions',
      cancel: 'Cancel',
      tasksQueue: 'Queue',
      tasksScan: 'Scan all tasks',
      tasksRun: 'Run queue',
      tasksAccount: 'Account tasks',
      concurrency: 'Concurrency',
      growth: 'Growth rewards',
      queueIdle: 'Queue idle',
      queueRunning: 'Queue running',
      progress: 'Progress',
      reward: 'Reward',
      accept: 'Accept',
      acceptAll: 'Accept all',
      claim: 'Claim',
      claimed: 'Claimed',
      claimable: 'Claimable',
      auto: 'Auto',
      autoAll: 'Auto all',
      pendingCount: 'Pending',
      scanResult: 'Scan result',
      groupBy: 'Group',
      metrics: 'Request metrics',
      completed: 'Completed',
      succeeded: 'Succeeded',
      failed: 'Failed',
      inFlightNow: 'In flight',
      archive: 'Archive',
      requestLogs: 'Request log',
      packages: 'Packages',
      vouchers: 'Vouchers',
      probes: 'Model probes',
      remain: 'Remain',
      size: 'Size',
      notSupported: 'This endpoint does not exist in the running binary (upgrade wb2api).',
      gateUnsupported: 'This binary has no per-model gate; the list below is read-only until you upgrade wb2api.',
      gateHidden: 'This build hides models through config.models.hidden (read-only here; edit config to change).',
    };

    const isZh = () => {
      try {
        return String(navigator.language || 'en').toLowerCase().indexOf('zh') === 0;
      } catch {
        return false;
      }
    };
    const DICT = isZh() ? ZH : EN;
    const T = (key) => DICT[key] || key;

    // ---------------------------------------------------------------- helpers

    const num = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
    };
    const compact = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
      return String(n);
    };
    const ms = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '—';
      return n >= 1000 ? (n / 1000).toFixed(1) + 's' : Math.round(n) + 'ms';
    };
    const uptime = (sec) => {
      const n = Number(sec);
      if (!Number.isFinite(n) || n <= 0) return '—';
      const d = Math.floor(n / 86400);
      const hrs = Math.floor((n % 86400) / 3600);
      const min = Math.floor((n % 3600) / 60);
      if (d > 0) return `${d}d ${hrs}h`;
      if (hrs > 0) return `${hrs}h ${min}m`;
      return `${min}m`;
    };
    const isZero = (ts) => !ts || String(ts).startsWith('0001-01-01');
    const when = (ts) => {
      if (isZero(ts)) return '—';
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) return '—';
      const diff = Date.now() - t;
      if (diff < 60000) return '<1m';
      if (diff < 3600000) return Math.round(diff / 60000) + 'm';
      if (diff < 86400000) return Math.round(diff / 3600000) + 'h';
      return new Date(t).toLocaleDateString();
    };
    const clock = (ts) => {
      if (!ts) return '—';
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleTimeString([], { hour12: false });
    };

    async function jsonFetch(url, init) {
      const res = await fetch(url, {
        ...(init || {}),
        headers: { accept: 'application/json', ...((init && init.headers) || {}) },
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) {
        const detail = body && (body.error || body.message);
        const error = new Error(detail || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      return body;
    }

    /** Proxy payloads wrap the gateway answer in {ok,status,data}; unwrap for the UI. */
    const unwrap = (body) => (body && typeof body === 'object' && 'data' in body ? body.data : body);

    const getPanel = async (path) => unwrap(await jsonFetch('/wb2api/data?p=' + encodeURIComponent(path)));
    const postPanel = async (path, payload) =>
      unwrap(
        await jsonFetch('/wb2api/action?p=' + encodeURIComponent(path), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
        }),
      );

    const errText = (error) => {
      if (error && Number(error.status) === 404) return T('notSupported');
      return String((error && error.message) || error);
    };

    // ----------------------------------------------------------------- styles

    const CSS = `
.wb2p-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 32px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.wb2p-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wb2p-title { font-size: 15px; font-weight: 600; margin: 0; }
.wb2p-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); font-size: 12px; color: var(--dsw-alias-label-secondary); }
.wb2p-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.wb2p-dot.on { background: var(--dsw-alias-state-success-primary); }
.wb2p-dot.off { background: var(--dsw-alias-state-error-primary); }
.wb2p-spacer { flex: 1 1 auto; }
.wb2p-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 11px; font-size: 12px; cursor: pointer; font-family: inherit; }
.wb2p-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.wb2p-btn:disabled { opacity: .55; cursor: default; }
.wb2p-btn.primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-inverted); }
.wb2p-btn.danger { color: var(--dsw-alias-state-error-primary); }
.wb2p-btn.tiny { padding: 3px 8px; font-size: 11px; border-radius: 6px; }
.wb2p-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex-wrap: wrap; }
.wb2p-tab { appearance: none; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--dsw-alias-label-secondary); padding: 7px 11px; font-size: 13px; cursor: pointer; font-family: inherit; }
.wb2p-tab.active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.wb2p-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; }
.wb2p-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 10px 12px; }
.wb2p-card .k { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.wb2p-card .v { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wb2p-meta { display: flex; gap: 18px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.wb2p-meta code, .wb2p-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.wb2p-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.wb2p-table th { text-align: left; font-weight: 500; color: var(--dsw-alias-label-secondary); padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.wb2p-table td { padding: 7px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); vertical-align: middle; }
.wb2p-table tr:last-child td { border-bottom: none; }
.wb2p-scroll { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: auto; max-height: 52vh; background: var(--dsw-alias-bg-layer-1); }
.wb2p-name { font-weight: 500; }
.wb2p-sub { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.wb2p-pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.wb2p-pill.ok { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.wb2p-pill.warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.wb2p-pill.err { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.wb2p-actions { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
.wb2p-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wb2p-input, .wb2p-select { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 9px; font-size: 12px; font-family: inherit; }
.wb2p-input { min-width: 200px; }
.wb2p-switch { position: relative; width: 34px; height: 19px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); cursor: pointer; padding: 0; appearance: none; }
.wb2p-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); transition: transform .15s ease, background .15s ease; }
.wb2p-switch[aria-checked='true'] { background: var(--dsw-alias-button-primary-fill); border-color: transparent; }
.wb2p-switch[aria-checked='true']::after { transform: translateX(15px); background: var(--dsw-alias-label-primary-inverted); }
.wb2p-log { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.55; padding: 10px 12px; margin: 0; white-space: pre-wrap; word-break: break-all; color: var(--dsw-alias-label-secondary); }
.wb2p-log .ts { color: var(--dsw-alias-label-tertiary); margin-right: 8px; }
.wb2p-error { border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 8px; padding: 8px 11px; font-size: 12px; }
.wb2p-note { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.wb2p-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 18px; text-align: center; }
.wb2p-panelbox { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.wb2p-link { color: var(--dsw-alias-link); word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.wb2p-progress { height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; min-width: 60px; }
.wb2p-progress > i { display: block; height: 100%; background: var(--dsw-alias-brand-primary); }
`;

    function Styles() {
      return h('style', { 'data-wb2api-panel': 'true' }, CSS);
    }

    const pill = (text, kind) => h('span', { className: 'wb2p-pill' + (kind ? ' ' + kind : '') }, text);

    const Card = ({ label, value }) =>
      h('div', { className: 'wb2p-card' }, h('div', { className: 'k' }, label), h('div', { className: 'v' }, value));

    const Loading = () => h('div', { className: 'wb2p-empty' }, T('loading'));

    // ------------------------------------------------------------------ panel

    function Panel() {
      const [tab, setTab] = React.useState('overview');
      const [snap, setSnap] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [note, setNote] = React.useState('');

      const [models, setModels] = React.useState(null);
      const [gate, setGate] = React.useState(null);
      const [usage, setUsage] = React.useState(null);
      const [logs, setLogs] = React.useState(null);
      const [query, setQuery] = React.useState('');

      const [realm, setRealm] = React.useState('cn');
      const [regions, setRegions] = React.useState(null);
      const [loginSession, setLoginSession] = React.useState(null);
      const [loginStatus, setLoginStatus] = React.useState('');

      const [queue, setQueue] = React.useState(null);
      const [scan, setScan] = React.useState(null);
      const [taskUid, setTaskUid] = React.useState('');
      const [taskList, setTaskList] = React.useState(null);
      const [concurrency, setConcurrency] = React.useState(2);
      const [growth, setGrowth] = React.useState(true);

      const [diag, setDiag] = React.useState({});

      const loadState = React.useCallback(async () => {
        try {
          const next = await jsonFetch('/wb2api/state');
          setSnap(next);
          setError('');
          return next;
        } catch (err) {
          setError(errText(err));
          return null;
        }
      }, []);

      React.useEffect(() => {
        loadState();
      }, [loadState]);

      const safely = async (label, fn) => {
        setBusy(label);
        setError('');
        try {
          const value = await fn();
          return value;
        } catch (err) {
          setError(errText(err));
          return null;
        } finally {
          setBusy('');
        }
      };

      // ---- lazy loaders per tab

      /** Models + whether this binary owns the per-model gate (persisted as models.disabled). */
      const loadModels = React.useCallback(async () => {
        const list = await getPanel('/panel/api/models');
        setModels(list);
        try {
          const cfg = await getPanel('/panel/api/config');
          const map = cfg && cfg.config ? cfg.config : cfg;
          const mc = (map && map.models) || {};
          setGate(Array.isArray(mc.disabled) ? 'toggle' : Array.isArray(mc.hidden) ? 'hidden' : 'none');
        } catch {
          setGate('none');
        }
      }, []);

      React.useEffect(() => {
        if (tab === 'models' && !models) {
          safely('models', loadModels);
        }
        if (tab === 'usage' && !usage) {
          safely('usage', async () => setUsage(await getPanel('/panel/api/usage')));
        }
        if (tab === 'login' && !regions) {
          safely('regions', async () => setRegions(await getPanel('/panel/api/login/regions')));
        }
        if (tab === 'logs') {
          safely('logs', async () => {
            const panelLog = await getPanel('/panel/api/logs?limit=120');
            const tail = await jsonFetch('/wb2api/proc?action=logs&lines=120');
            setLogs({ entries: (panelLog && panelLog.entries) || [], stdout: (tail && tail.lines) || [] });
          });
        }
      }, [tab, models, usage, regions]);

      // ---- queue polling while the tasks tab is open

      React.useEffect(() => {
        if (tab !== 'tasks') return undefined;
        let alive = true;
        const tick = async () => {
          try {
            const next = await getPanel('/panel/api/tasks/queue');
            if (alive) setQueue(next);
          } catch (err) {
            if (alive) setError(errText(err));
          }
        };
        tick();
        const id = setInterval(tick, 3000);
        return () => {
          alive = false;
          clearInterval(id);
        };
      }, [tab]);

      // ---- login polling

      React.useEffect(() => {
        if (!loginSession) return undefined;
        let alive = true;
        const id = setInterval(async () => {
          try {
            const data = await getPanel('/panel/api/login/poll?state=' + encodeURIComponent(loginSession.state));
            if (!alive) return;
            if (data && data.done) {
              setLoginStatus(
                `${T('loginDone')}: ${data.nickname || data.uid}（${data.realm || ''}）` +
                  (data.credits !== undefined ? ` · ${num(data.credits)}` : '') +
                  (data.checkin_message ? ` · ${data.checkin_message}` : ''),
              );
              setLoginSession(null);
              await loadState();
            } else {
              setLoginStatus((data && data.message) || T('loginWaiting'));
            }
          } catch (err) {
            if (alive) setLoginStatus(errText(err));
          }
        }, 2500);
        return () => {
          alive = false;
          clearInterval(id);
        };
      }, [loginSession, loadState]);

      // ---- actions

      const proc = (action) =>
        safely('proc:' + action, async () => {
          await jsonFetch(`/wb2api/proc?action=${action}`, { method: 'POST' });
          await loadState();
          setNote(action + ' ✓');
        });

      const act = (path) =>
        safely('act:' + path, async () => {
          await postPanel(path, {});
          setNote('✓');
          await loadState();
        });

      const bulk = (kind) =>
        safely('bulk:' + kind, async () => {
          const path = {
            checkin: '/panel/api/checkin_all',
            balance: '/panel/api/balance_all',
            travel: '/panel/api/travel_all',
            activity: '/panel/api/activity_all',
            keepalive: '/panel/api/keepalive_all',
          }[kind];
          const result = await postPanel(path, {});
          setNote(kind + ' ✓');
          await loadState();
          return result;
        });

      const toggleModel = (model) =>
        safely('model:' + model.id, async () => {
          try {
            await postPanel('/panel/api/models/toggle', { id: model.id, disabled: !model.disabled });
          } catch (err) {
            if (Number(err && err.status) === 404) setGate('none');
            throw err;
          }
          await loadModels();
        });

      const startLogin = () =>
        safely('login:start', async () => {
          setLoginStatus('');
          const data = await postPanel('/panel/api/login/start', { realm });
          if (data && data.ok === false) {
            setLoginStatus(data.error || 'start failed');
            return;
          }
          setLoginSession({ state: data.state, url: data.url, realm: data.realm || realm });
          setLoginStatus(T('loginWaiting'));
        });

      const scanTasks = () =>
        safely('tasks:scan', async () => {
          const data = await postPanel('/panel/api/tasks/scan_all', {});
          setScan(data);
        });

      const runQueue = () =>
        safely('tasks:run', async () => {
          const data = await postPanel('/panel/api/tasks/run_queue', { concurrency, growth });
          setNote((data && data.message) || 'queue ✓');
          setQueue(await getPanel('/panel/api/tasks/queue'));
        });

      const loadAccountTasks = (uid) =>
        safely('tasks:account', async () => {
          setTaskUid(uid);
          const data = await getPanel(`/panel/api/accounts/${uid}/tasks`);
          setTaskList((data && data.tasks) || []);
        });

      const claimTask = (uid, code) =>
        safely('tasks:claim', async () => {
          await postPanel(`/panel/api/accounts/${uid}/tasks/claim`, { task_code: code });
          const data = await getPanel(`/panel/api/accounts/${uid}/tasks`);
          setTaskList((data && data.tasks) || []);
        });

      const acceptTask = (uid, code) =>
        safely('tasks:accept', async () => {
          await postPanel(`/panel/api/accounts/${uid}/tasks/accept`, { task_codes: [code] });
          const data = await getPanel(`/panel/api/accounts/${uid}/tasks`);
          setTaskList((data && data.tasks) || []);
        });

      const accountAuto = (uid, all) =>
        safely('tasks:auto', async () => {
          await postPanel(`/panel/api/accounts/${uid}/tasks/${all ? 'auto_all' : 'auto'}`, {});
          await loadState();
          setNote('✓');
        });

      const loadDiag = (kind) =>
        safely('diag:' + kind, async () => {
          const path = {
            metrics: '/panel/api/request_metrics',
            requests: '/panel/api/request_logs?limit=80',
            packages: '/panel/api/packages',
            vouchers: '/panel/api/school/vouchers',
            probes: '/panel/api/model_probes',
          }[kind];
          const data = await getPanel(path);
          setDiag((prev) => ({ ...prev, [kind]: data }));
        });

      // ---- derived

      const service = (snap && snap.service) || { running: false };
      const overview = (snap && snap.overview) || null;
      const online = Boolean(service.running);
      const accounts = overview && Array.isArray(overview.accounts) ? overview.accounts : [];

      const statusPill = (account) => {
        if (account.disabled) return pill(T('disabled'), 'err');
        if (account.cooling) return pill(T('cooling'), 'warn');
        if (account.paused) return pill(T('paused'), 'warn');
        return pill(T('enabled'), 'ok');
      };

      const accountRow = (account, withActions) => {
        const info = account.token_usage || {};
        const paused = Boolean(account.paused);
        return h(
          'tr',
          { key: account.uid },
          h(
            'td',
            null,
            h('div', { className: 'wb2p-name' }, account.nickname || String(account.uid).slice(0, 8)),
            h('div', { className: 'wb2p-sub wb2p-mono' }, account.realm || '—'),
          ),
          h('td', null, statusPill(account)),
          h(
            'td',
            null,
            h('div', { className: 'wb2p-name' }, num(account.credits)),
            h('div', { className: 'wb2p-sub' }, T('used') + ' ' + num((account.credits_total || 0) - (account.credits || 0))),
          ),
          h('td', null, num(info.request_count)),
          h('td', null, compact(info.total_tokens)),
          h('td', { className: 'wb2p-mono' }, when(info.last_used_at)),
          withActions
            ? h(
                'td',
                null,
                h(
                  'div',
                  { className: 'wb2p-actions' },
                  h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => act(`/panel/api/accounts/${account.uid}/checkin`) }, T('checkin')),
                  h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => act(`/panel/api/accounts/${account.uid}/balance`) }, T('balance')),
                  h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => act(`/panel/api/accounts/${account.uid}/${paused ? 'resume' : 'pause'}`) }, paused ? T('resume') : T('pause')),
                  h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => loadAccountTasks(account.uid) }, T('tasks')),
                  h(
                    'button',
                    { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => act(`/panel/api/accounts/${account.uid}/${account.disabled ? 'revive' : 'disable'}`) },
                    account.disabled ? T('revive') : T('disable'),
                  ),
                ),
              )
            : null,
        );
      };

      const accountTable = (rows, withActions) =>
        h(
          'div',
          { className: 'wb2p-scroll' },
          h(
            'table',
            { className: 'wb2p-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, T('account')),
                h('th', null, T('state')),
                h('th', null, T('credits')),
                h('th', null, T('requests')),
                h('th', null, T('tokens')),
                h('th', null, T('lastUsed')),
                withActions ? h('th', { style: { textAlign: 'right' } }, '') : null,
              ),
            ),
            h(
              'tbody',
              null,
              rows.length
                ? rows.map((row) => accountRow(row, withActions))
                : h('tr', null, h('td', { colSpan: withActions ? 7 : 6, className: 'wb2p-empty' }, T('empty'))),
            ),
          ),
        );

      // ---- tabs

      const overviewTab = () =>
        h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-grid' },
            h(Card, { label: T('total'), value: overview ? num(overview.total) : '—' }),
            h(Card, { label: T('healthy'), value: overview ? num(overview.healthy) : '—' }),
            h(Card, { label: T('cooling'), value: overview ? num(overview.cooling) : '—' }),
            h(Card, { label: T('disabled'), value: overview ? num(overview.disabled) : '—' }),
            h(Card, { label: T('paused'), value: overview ? num(overview.paused) : '—' }),
            h(Card, { label: T('inFlight'), value: overview ? num(overview.in_flight_full) : '—' }),
          ),
          h(
            'div',
            { className: 'wb2p-meta' },
            h('span', null, T('version') + ': ', h('code', null, overview ? overview.version : '—')),
            h('span', null, T('uptime') + ': ', h('code', null, overview ? uptime(overview.uptime_sec) : '—')),
            h('span', null, T('redis') + ': ', h('code', null, overview ? overview.redis_mode : '—')),
            h('span', null, T('sticky') + ': ', h('code', null, overview ? num(overview.sticky_sessions) : '—')),
            h('span', null, T('baseUrl') + ': ', h('code', null, (snap && snap.baseUrl) || '—')),
            h('span', null, T('pid') + ': ', h('code', null, service.running ? service.host + ':' + service.port : '—')),
          ),
          online ? accountTable(accounts.slice(0, 50), false) : h('div', { className: 'wb2p-empty' }, T('unreachableHint')),
        );

      const accountsTab = () =>
        h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => bulk('checkin') }, T('checkin')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => bulk('balance') }, T('balance')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => bulk('travel') }, T('travel')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => bulk('activity') }, T('activity')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => bulk('keepalive') }, T('keepalive')),
            h('div', { className: 'wb2p-spacer' }),
            h('span', { className: 'wb2p-sub' }, accounts.length + ' ' + T('accounts')),
          ),
          accountTable(accounts, true),
        );

      const loginTab = () =>
        h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-panelbox' },
            h(
              'div',
              { className: 'wb2p-row' },
              h('span', { className: 'wb2p-sub' }, T('loginRealm')),
              h(
                'select',
                { className: 'wb2p-select', value: realm, onChange: (event) => setRealm(event.target.value) },
                h('option', { value: 'cn' }, T('loginCn')),
                h('option', { value: 'global' }, T('loginGlobal')),
              ),
              h('button', { className: 'wb2p-btn primary', disabled: Boolean(busy) || Boolean(loginSession), onClick: startLogin }, T('loginStart')),
              loginSession
                ? h('button', { className: 'wb2p-btn', onClick: () => { setLoginSession(null); setLoginStatus(''); } }, T('cancel'))
                : null,
            ),
            loginSession
              ? h(
                  'div',
                  null,
                  h('div', { className: 'wb2p-sub' }, T('loginOpen')),
                  h('a', { className: 'wb2p-link', href: loginSession.url, target: '_blank', rel: 'noreferrer noopener' }, loginSession.url),
                )
              : h('div', { className: 'wb2p-sub' }, T('loginIdle')),
            loginStatus ? h('div', { className: 'wb2p-note' }, loginStatus) : null,
            realm === 'global' && regions && Array.isArray(regions.regions)
              ? h(
                  'div',
                  { className: 'wb2p-row' },
                  h('span', { className: 'wb2p-sub' }, T('loginRegions') + ':'),
                  regions.regions.map((entry) => pill(entry.name + ' · ' + entry.code)),
                )
              : null,
          ),
        );

      const queueBox = () => {
        const running = Boolean(queue && queue.running);
        const items = (queue && queue.items) || [];
        return h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            pill(running ? T('queueRunning') : T('queueIdle'), running ? 'ok' : undefined),
            h('span', { className: 'wb2p-sub' }, `${T('completed')}: ${num(queue && queue.seq)} / ${num(queue && queue.total)} · ${T('concurrency')}: ${num(queue && queue.conc)}`),
            h('div', { className: 'wb2p-spacer' }),
            h(
              'label',
              { className: 'wb2p-row wb2p-sub' },
              T('concurrency'),
              h('input', {
                className: 'wb2p-input',
                style: { minWidth: 60, width: 60 },
                type: 'number',
                min: 1,
                max: 8,
                value: concurrency,
                onChange: (event) => setConcurrency(Number(event.target.value) || 1),
              }),
            ),
            h(
              'label',
              { className: 'wb2p-row wb2p-sub' },
              h('input', { type: 'checkbox', checked: growth, onChange: (event) => setGrowth(event.target.checked) }),
              T('growth'),
            ),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: scanTasks }, T('tasksScan')),
            h('button', { className: 'wb2p-btn primary', disabled: Boolean(busy) || running, onClick: runQueue }, T('tasksRun')),
          ),
          h(
            'div',
            { className: 'wb2p-scroll' },
            h(
              'table',
              { className: 'wb2p-table' },
              h(
                'thead',
                null,
                h('tr', null, h('th', null, T('account')), h('th', null, T('modelId')), h('th', null, T('state')), h('th', null, '')),
              ),
              h(
                'tbody',
                null,
                items.length
                  ? items.map((item, index) =>
                      h(
                        'tr',
                        { key: item.uid + ':' + item.code + ':' + index },
                        h('td', null, h('div', { className: 'wb2p-name' }, item.nickname || String(item.uid).slice(0, 8)), h('div', { className: 'wb2p-sub wb2p-mono' }, item.kind || '')),
                        h('td', { className: 'wb2p-mono' }, item.code),
                        h('td', null, pill(item.status, item.status === 'done' ? 'ok' : item.status === 'error' ? 'err' : item.status === 'running' ? 'warn' : undefined)),
                        h('td', { className: 'wb2p-sub' }, item.message || ''),
                      ),
                    )
                  : h('tr', null, h('td', { colSpan: 4, className: 'wb2p-empty' }, T('empty'))),
              ),
            ),
          ),
          scan
            ? h(
                'div',
                { className: 'wb2p-panelbox' },
                h('div', { className: 'wb2p-sub' }, `${T('scanResult')} · ${T('pendingCount')} ${num(scan.pending_count)}`),
                h(
                  'div',
                  { className: 'wb2p-row' },
                  (scan.accounts || []).map((entry) =>
                    pill(
                      `${entry.nickname || String(entry.uid).slice(0, 6)}: ${(entry.growth || []).length}`,
                      entry.growth_error ? 'warn' : undefined,
                    ),
                  ),
                ),
              )
            : null,
        );
      };

      const accountTasksBox = () => {
        if (!taskUid) return null;
        const rows = taskList || [];
        const account = accounts.find((entry) => entry.uid === taskUid);
        return h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            h('span', { className: 'wb2p-sub' }, T('tasksAccount') + ': ' + ((account && account.nickname) || taskUid)),
            h('div', { className: 'wb2p-spacer' }),
            h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => accountAuto(taskUid, false) }, T('auto')),
            h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => accountAuto(taskUid, true) }, T('autoAll')),
            h('button', { className: 'wb2p-btn tiny', onClick: () => loadAccountTasks(taskUid) }, T('refresh')),
          ),
          h(
            'div',
            { className: 'wb2p-scroll' },
            h(
              'table',
              { className: 'wb2p-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, T('modelId')),
                  h('th', null, T('progress')),
                  h('th', null, T('reward')),
                  h('th', null, T('state')),
                  h('th', { style: { textAlign: 'right' } }, ''),
                ),
              ),
              h(
                'tbody',
                null,
                rows.length
                  ? rows.map((task) =>
                      h(
                        'tr',
                        { key: task.task_code },
                        h(
                          'td',
                          null,
                          h('div', { className: 'wb2p-name' }, task.title || task.task_code),
                          h('div', { className: 'wb2p-sub' }, task.task_desc || task.description || ''),
                        ),
                        h(
                          'td',
                          null,
                          h('div', { className: 'wb2p-sub' }, `${num(task.current)} / ${num(task.target)}`),
                          h(
                            'div',
                            { className: 'wb2p-progress' },
                            h('i', { style: { width: Math.min(100, task.target ? (task.current / task.target) * 100 : 0) + '%' } }),
                          ),
                        ),
                        h('td', { className: 'wb2p-sub' }, `+${num(task.credit)} 分 / +${num(task.energy)}`),
                        h(
                          'td',
                          null,
                          task.claimed
                            ? pill(T('claimed'))
                            : task.claimable
                              ? pill(T('claimable'), 'ok')
                              : task.accept_status
                                ? pill(task.accept_status)
                                : pill(task.status || '—'),
                        ),
                        h(
                          'td',
                          null,
                          h(
                            'div',
                            { className: 'wb2p-actions' },
                            task.claimable && !task.claimed
                              ? h('button', { className: 'wb2p-btn tiny primary', disabled: Boolean(busy), onClick: () => claimTask(taskUid, task.task_code) }, T('claim'))
                              : null,
                            !task.accept_status
                              ? h('button', { className: 'wb2p-btn tiny', disabled: Boolean(busy), onClick: () => acceptTask(taskUid, task.task_code) }, T('accept'))
                              : null,
                          ),
                        ),
                      ),
                    )
                  : h('tr', null, h('td', { colSpan: 5, className: 'wb2p-empty' }, T('empty'))),
              ),
            ),
          ),
        );
      };

      const tasksTab = () =>
        h(
          'div',
          { className: 'wb2p-root' },
          queueBox(),
          h(
            'div',
            { className: 'wb2p-row' },
            h('span', { className: 'wb2p-sub' }, T('tasksAccount')),
            h(
              'select',
              {
                className: 'wb2p-select',
                value: taskUid,
                onChange: (event) => (event.target.value ? loadAccountTasks(event.target.value) : (setTaskUid(''), setTaskList(null))),
              },
              h('option', { value: '' }, '—'),
              accounts.map((account) => h('option', { key: account.uid, value: account.uid }, account.nickname || String(account.uid).slice(0, 8))),
            ),
          ),
          accountTasksBox(),
        );

      const modelsTab = () => {
        const list = (models && Array.isArray(models.models) && models.models) || [];
        const filtered = query ? list.filter((model) => (model.id + ' ' + (model.name || '')).toLowerCase().includes(query.toLowerCase())) : list;
        return h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            h('input', { className: 'wb2p-input', placeholder: T('search'), value: query, onChange: (event) => setQuery(event.target.value) }),
            h('div', { className: 'wb2p-spacer' }),
            h('span', { className: 'wb2p-sub' }, filtered.length + ' / ' + list.length),
            h('button', { className: 'wb2p-btn', onClick: () => safely('models', loadModels) }, T('refresh')),
          ),
          gate === 'hidden' ? h('div', { className: 'wb2p-note' }, pill(T('gateHidden'), 'warn')) : gate === 'none' ? h('div', { className: 'wb2p-note' }, pill(T('gateUnsupported'), 'warn')) : null,
          h(
            'div',
            { className: 'wb2p-scroll' },
            h(
              'table',
              { className: 'wb2p-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, T('modelId')),
                  h('th', null, T('rate')),
                  h('th', null, T('context')),
                  h('th', null, T('maxOutput')),
                  h('th', null, T('state')),
                  h('th', { style: { textAlign: 'right' } }, T('enabled')),
                ),
              ),
              h(
                'tbody',
                null,
                filtered.length
                  ? filtered.map((model) =>
                      h(
                        'tr',
                        { key: model.id },
                        h('td', null, h('div', { className: 'wb2p-name' }, model.name || model.id), h('div', { className: 'wb2p-sub wb2p-mono' }, model.id)),
                        h('td', { className: 'wb2p-mono' }, model.credits || '—'),
                        h('td', { className: 'wb2p-mono' }, compact(model.context_length)),
                        h('td', { className: 'wb2p-mono' }, compact(model.max_output_tokens)),
                        h(
                          'td',
                          null,
                          gate !== 'toggle'
                            ? pill('—')
                            : model.disabled
                              ? pill(T('blocked'), 'err')
                              : pill(T('enabled'), 'ok'),
                        ),
                        h(
                          'td',
                          { style: { textAlign: 'right' } },
                          h('button', {
                            className: 'wb2p-switch',
                            role: 'switch',
                            'aria-checked': model.disabled ? 'false' : 'true',
                            'aria-label': model.id,
                            disabled: Boolean(busy) || gate !== 'toggle',
                            onClick: () => toggleModel(model),
                          }),
                        ),
                      ),
                    )
                  : h('tr', null, h('td', { colSpan: 6, className: 'wb2p-empty' }, T('loading'))),
              ),
            ),
          ),
        );
      };

      const usageTab = () => {
        const totals = (usage && usage.totals) || {};
        const byModel = (usage && Array.isArray(usage.by_model) && usage.by_model) || [];
        const byAccount = (usage && Array.isArray(usage.by_account) && usage.by_account) || [];
        const groupTable = (title, rowsData, keyField) =>
          h(
            'div',
            { className: 'wb2p-scroll' },
            h(
              'table',
              { className: 'wb2p-table' },
              h('thead', null, h('tr', null, h('th', null, title), h('th', null, T('requests')), h('th', null, T('tokens')), h('th', null, T('errors')))),
              h(
                'tbody',
                null,
                rowsData.length
                  ? rowsData.map((row, index) =>
                      h(
                        'tr',
                        { key: (row[keyField] || '') + index },
                        h('td', { className: 'wb2p-mono' }, row[keyField] || '—'),
                        h('td', null, num(row.requests)),
                        h('td', null, compact(row.total_tokens)),
                        h('td', null, num(row.errors)),
                      ),
                    )
                  : h('tr', null, h('td', { colSpan: 4, className: 'wb2p-empty' }, T('empty'))),
              ),
            ),
          );
        return h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            h('span', { className: 'wb2p-sub' }, T('usageTotals')),
            h('div', { className: 'wb2p-spacer' }),
            h('button', { className: 'wb2p-btn', onClick: () => safely('usage', async () => setUsage(await getPanel('/panel/api/usage'))) }, T('refresh')),
          ),
          h(
            'div',
            { className: 'wb2p-grid' },
            h(Card, { label: T('requests'), value: num(totals.requests) }),
            h(Card, { label: T('errors'), value: num(totals.errors) }),
            h(Card, { label: T('tokens'), value: compact(totals.total_tokens) }),
            h(Card, { label: T('credits'), value: num(totals.credits) }),
            h(Card, { label: T('avgLatency'), value: ms(totals.avg_latency_ms) }),
            h(Card, {
              label: T('successRate'),
              value: totals.requests ? (((totals.requests - totals.errors) / totals.requests) * 100).toFixed(1) + '%' : '—',
            }),
          ),
          groupTable(T('modelId'), byModel, 'model'),
          groupTable(T('account'), byAccount, 'account'),
        );
      };

      const diagTab = () => {
        const metrics = diag.metrics || null;
        const requests = diag.requests || null;
        const packages = diag.packages || null;
        const vouchers = diag.vouchers || null;
        const probes = diag.probes || null;
        const entries = (requests && Array.isArray(requests.entries) && requests.entries) || [];
        const columns = entries.length ? Object.keys(entries[0]).slice(0, 8) : [];
        const accountBoxes = (label, payload, render) =>
          payload && Array.isArray(payload.accounts)
            ? h(
                'div',
                { className: 'wb2p-panelbox' },
                h('div', { className: 'wb2p-sub' }, label),
                payload.accounts.map((entry) =>
                  h(
                    'div',
                    { key: entry.uid, className: 'wb2p-row' },
                    h('span', { className: 'wb2p-name' }, entry.nickname || String(entry.uid).slice(0, 8)),
                    entry.error ? pill(String(entry.error).slice(0, 60), 'warn') : render(entry),
                  ),
                ),
              )
            : null;
        return h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => loadDiag('metrics') }, T('metrics')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => loadDiag('requests') }, T('requestLogs')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => loadDiag('packages') }, T('packages')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => loadDiag('vouchers') }, T('vouchers')),
            h('button', { className: 'wb2p-btn', disabled: Boolean(busy), onClick: () => loadDiag('probes') }, T('probes')),
          ),
          metrics
            ? h(
                'div',
                { className: 'wb2p-grid' },
                h(Card, { label: T('completed'), value: num(metrics.completed) }),
                h(Card, { label: T('succeeded'), value: num(metrics.succeeded) }),
                h(Card, { label: T('failed'), value: num(metrics.failed) }),
                h(Card, { label: T('inFlightNow'), value: num(metrics.in_flight) }),
                h(Card, { label: T('successRate'), value: (Number(metrics.success_rate || 0) * 100).toFixed(1) + '%' }),
                h(Card, { label: T('avgLatency'), value: ms(metrics.avg_duration_ms) }),
                h(Card, { label: T('archive'), value: metrics.archive ? num(metrics.archive.files) + ' · ' + compact(metrics.archive.bytes) : '—' }),
              )
            : null,
          requests
            ? h(
                'div',
                { className: 'wb2p-scroll' },
                h(
                  'table',
                  { className: 'wb2p-table' },
                  h('thead', null, h('tr', null, columns.map((column) => h('th', { key: column }, column)))),
                  h(
                    'tbody',
                    null,
                    entries.length
                      ? entries.map((entry, index) =>
                          h(
                            'tr',
                            { key: index },
                            columns.map((column) =>
                              h('td', { key: column, className: 'wb2p-mono' }, typeof entry[column] === 'object' ? JSON.stringify(entry[column]).slice(0, 60) : String(entry[column] ?? '')),
                            ),
                          ),
                        )
                      : h('tr', null, h('td', { colSpan: 8, className: 'wb2p-empty' }, T('empty'))),
                  ),
                ),
              )
            : null,
          accountBoxes(T('packages'), packages, (entry) =>
            h('span', { className: 'wb2p-sub' }, `${T('remain')} ${num(entry.remain)} / ${num(entry.size)}` + ((entry.packages || []).length ? ` · ${entry.packages.map((pkg) => pkg.name).join(', ')}` : '')),
          ),
          accountBoxes(T('vouchers'), vouchers, (entry) => h('span', { className: 'wb2p-sub' }, String((entry.vouchers || []).length) + ' ' + T('vouchers'))),
          probes
            ? h('div', { className: 'wb2p-panelbox' }, h('div', { className: 'wb2p-sub' }, T('probes')), h('pre', { className: 'wb2p-log' }, JSON.stringify(probes, null, 2).slice(0, 4000)))
            : null,
        );
      };

      const logsTab = () => {
        const entries = (logs && logs.entries) || [];
        const stdout = (logs && logs.stdout) || [];
        return h(
          'div',
          { className: 'wb2p-root' },
          h(
            'div',
            { className: 'wb2p-row' },
            h('span', { className: 'wb2p-sub' }, T('panelLogs')),
            h('div', { className: 'wb2p-spacer' }),
            h(
              'button',
              {
                className: 'wb2p-btn',
                onClick: () =>
                  safely('logs', async () => {
                    const panelLog = await getPanel('/panel/api/logs?limit=120');
                    const tail = await jsonFetch('/wb2api/proc?action=logs&lines=120');
                    setLogs({ entries: (panelLog && panelLog.entries) || [], stdout: (tail && tail.lines) || [] });
                  }),
              },
              T('refresh'),
            ),
          ),
          h(
            'div',
            { className: 'wb2p-scroll' },
            h(
              'pre',
              { className: 'wb2p-log' },
              entries.length
                ? entries.map((entry, index) => h('div', { key: index }, h('span', { className: 'ts' }, clock(entry.ts)), entry.text))
                : T('empty'),
            ),
          ),
          h('span', { className: 'wb2p-sub' }, T('runtimeLogs')),
          h('div', { className: 'wb2p-scroll' }, h('pre', { className: 'wb2p-log' }, stdout.length ? stdout.join('\n') : T('empty'))),
        );
      };

      const tabs = [
        ['overview', T('overview'), overviewTab],
        ['accounts', T('accounts'), accountsTab],
        ['login', T('login'), loginTab],
        ['tasks', T('tasks'), tasksTab],
        ['models', T('models'), modelsTab],
        ['usage', T('usage'), usageTab],
        ['diagnostics', T('diagnostics'), diagTab],
        ['logs', T('logs'), logsTab],
      ];
      const active = tabs.find((entry) => entry[0] === tab) || tabs[0];

      // 注入失败必须出现在页面上：否则用户只看到「装了插件但模型列表没有 wb2api」。
      const prov = snap && snap.provider;
      const providerWarning =
        prov && prov.ok === false
          ? (prov.code === 'LLM_PI_AI_MISSING' ? T('providerNoAdapter') : T('providerBroken')) + ': ' + (prov.reason || '')
          : null;

      const staleWarning = snap && snap.code && snap.code.stale ? T('staleCode') : null;

      return h(
        'div',
        { className: 'wb2p-root' },
        h(Styles),
        h(
          'div',
          { className: 'wb2p-head' },
          h('h2', { className: 'wb2p-title' }, T('section')),
          h('span', { className: 'wb2p-badge' }, h('span', { className: 'wb2p-dot ' + (online ? 'on' : 'off') }), online ? T('reachable') : T('unreachable')),
          snap && snap.apiConfigured === false ? pill(T('noKey'), 'warn') : null,
          snap && snap.panelDirExists === false ? pill(T('noPanelDir'), 'warn') : null,
          h('div', { className: 'wb2p-spacer' }),
          h('button', { className: 'wb2p-btn', disabled: busy === 'proc:start', onClick: loadState }, T('refresh')),
          h('button', { className: 'wb2p-btn primary', disabled: Boolean(busy) || online, onClick: () => proc('start') }, T('start')),
          h('button', { className: 'wb2p-btn', disabled: Boolean(busy) || !online, onClick: () => proc('restart') }, T('restart')),
          h('button', { className: 'wb2p-btn danger', disabled: Boolean(busy) || !online, onClick: () => proc('stop') }, T('stop')),
        ),
        error ? h('div', { className: 'wb2p-error' }, error) : null,
        snap && snap.apiKeySource === 'none' ? h('div', { className: 'wb2p-error' }, T('noKeyHint')) : null,
        note ? h('div', { className: 'wb2p-note' }, note) : null,
        staleWarning ? h('div', { className: 'wb2p-error' }, staleWarning) : null,
        providerWarning ? h('div', { className: 'wb2p-error' }, providerWarning) : null,
        h(
          'div',
          { className: 'wb2p-tabs' },
          tabs.map(([key, label]) => h('button', { key, className: 'wb2p-tab' + (key === tab ? ' active' : ''), onClick: () => setTab(key) }, label)),
        ),
        active[2](),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'wb2api-panel',
              order: 46,
              label: () => T('section'),
            },
            Panel,
          ),
        );
      },
    };
  },
});
