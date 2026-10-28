#!/usr/bin/env node
/**
 * Functional test suite for the dsh-wb2api-panel bundle.
 *
 * Oracle command:  node test/run.mjs
 * Exit 0 only when every case passes. No external dependencies: React is
 * shimmed, and HTTP goes to the live Harness+gateway that the plugin was
 * installed into, so the suite exercises the real wire.
 *
 * Sections
 *   1. package/manifest integrity
 *   2. client module sandbox (loader factory, slot registration)
 *   3. client component render + interaction per tab (real data over HTTP)
 *   4. host module (tool registration, tool execution, proxy handler)
 *   5. live HTTP surface through the Harness web server
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = process.env.WB2API_TEST_BASE || 'http://127.0.0.1:5954';
const PANEL = process.env.WB2API_TEST_PANEL || 'http://127.0.0.1:7863';

const results = [];
let failures = 0;

function check(section, name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => {
      results.push({ section, name, ok: true, detail });
    })
    .catch((error) => {
      failures += 1;
      results.push({ section, name, ok: false, detail: String((error && error.message) || error) });
    });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const readText = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

// ---------------------------------------------------------------------------
// React shim: enough of the runtime to render the plugin's component tree in
// Node, drive hooks, and fire onClick handlers.
// ---------------------------------------------------------------------------
function createReactShim() {
  const stores = new Map();
  const pending = [];
  let pathStack = [];
  let hookIndex = 0;
  let dirty = false;

  const key = () => pathStack.join('/') + '#' + hookIndex++;

  const slot = (k) => {
    let entry = stores.get(k);
    if (!entry) {
      entry = { value: undefined, deps: undefined, cleanup: undefined, init: false };
      stores.set(k, entry);
    }
    return entry;
  };

  const React = {
    createElement(type, props, ...children) {
      const flat = [];
      const push = (child) => {
        if (Array.isArray(child)) child.forEach(push);
        else flat.push(child);
      };
      push(children);
      return { $$el: true, type, props: { ...(props || {}), children: flat } };
    },
    useState(initial) {
      const k = key();
      const entry = slot(k);
      if (!entry.init) {
        entry.value = typeof initial === 'function' ? initial() : initial;
        entry.init = true;
      }
      const setState = (next) => {
        const value = typeof next === 'function' ? next(entry.value) : next;
        if (value !== entry.value) {
          entry.value = value;
          dirty = true;
        }
      };
      return [entry.value, setState];
    },
    useReducer(reducer, initial) {
      const [state, setState] = React.useState(initial);
      return [state, (action) => setState(reducer(state, action))];
    },
    useMemo(factory, deps) {
      const entry = slot(key());
      if (!entry.init || !sameDeps(entry.deps, deps)) {
        entry.value = factory();
        entry.deps = deps;
        entry.init = true;
      }
      return entry.value;
    },
    useCallback(fn, deps) {
      return React.useMemo(() => fn, deps);
    },
    useRef(initial) {
      const entry = slot(key());
      if (!entry.init) {
        entry.value = { current: initial };
        entry.init = true;
      }
      return entry.value;
    },
    useEffect(fn, deps) {
      const k = key();
      const entry = slot(k);
      if (!entry.init || !sameDeps(entry.deps, deps)) {
        entry.deps = deps;
        entry.init = true;
        pending.push(fn);
      }
    },
  };

  function sameDeps(a, b) {
    if (a === undefined || b === undefined || a === null || b === null) return false;
    if (a.length !== b.length) return false;
    return a.every((value, index) => Object.is(value, b[index]));
  }

  function renderTree(node, out = []) {
    if (node === null || node === undefined || node === false || node === true) return out;
    if (Array.isArray(node)) {
      node.forEach((child) => renderTree(child, out));
      return out;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      out.push({ text: String(node) });
      return out;
    }
    if (typeof node.type === 'function') {
      const savedIndex = hookIndex;
      const savedStack = pathStack;
      pathStack = [...pathStack, node.type.name || 'anon'];
      hookIndex = 0;
      try {
        const rendered = node.type(node.props);
        renderTree(rendered, out);
      } finally {
        pathStack = savedStack;
        hookIndex = savedIndex;
      }
      return out;
    }
    const children = node.props ? node.props.children : [];
    const record = { tag: node.type, props: node.props || {}, children: [] };
    out.push(record);
    children.forEach((child) => renderTree(child, record.children));
    return out;
  }

  const collected = [];
  const text = (nodes, acc = []) => {
    nodes.forEach((node) => {
      if (node.text !== undefined) acc.push(node.text);
      else text(node.children || [], acc);
    });
    return acc;
  };

  return {
    React,
    text,
    render(Component) {
      collected.length = 0;
      renderTree({ $$el: true, type: Component, props: {} }, collected);
      return collected;
    },
    async flush(passes = 4) {
      for (let pass = 0; pass < passes; pass += 1) {
        dirty = false;
        while (pending.length) {
          const fn = pending.shift();
          const out = fn();
          if (out && typeof out.then === 'function') await out;
        }
        await new Promise((resolve) => setTimeout(resolve, 220));
        if (!dirty) break;
      }
    },
    /** Find a button/link whose text matches, and fire its handler. */
    async press(root, label) {
      const stack = [...root];
      let target = null;
      while (stack.length && !target) {
        const node = stack.shift();
        if (node.text !== undefined) continue;
        const own = text(node.children || []).join(' ');
        if (node.props && typeof node.props.onClick === 'function' && own.includes(label)) target = node;
        else stack.push(...(node.children || []));
      }
      assert(target, `no clickable element with text "${label}"`);
      target.props.onClick({ target: { value: '' } });
      await this.flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Load the client artifact in a sandbox with the shim injected.
// ---------------------------------------------------------------------------
function loadClientModule(reactShim) {
  const source = readText('client.js');
  const loaded = [];
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(input) {
          loaded.push(input);
        },
      },
    },
    navigator: { language: 'zh-CN' },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    URL,
    JSON,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  assert(loaded.length === 1, `expected one module registration, saw ${loaded.length}`);
  const module = loaded[0].factory((name) => {
    if (name === 'react') return reactShim.React;
    throw new Error(`unexpected client require: ${name}`);
  });
  return { registration: loaded[0], module };
}

// ---------------------------------------------------------------------------
// Host module: import with a fake Cordis context.
// ---------------------------------------------------------------------------
async function loadHostModule() {
  const module = await import(
    'file:///' + path.join(ROOT, 'index.js').replace(/\\/g, '/') + '?t=' + Date.now()
  );
  const captured = { tools: [], routes: [], effects: [] };
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register: (route) => (captured.routes.push(route), () => {}) };
      return undefined;
    },
    effect(fn) {
      captured.effects.push(fn);
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    tools: {
      register(definition) {
        captured.tools.push(definition);
        return () => {};
      },
    },
  };
  module.apply(ctx, {
    baseUrl: PANEL,
    panelDir: path.resolve(ROOT, '..', 'workbuddy2api-panel'),
    autoStart: false,      // 测试不碰宿主生命周期
    stopOnUnload: false,
  });
  return { module, captured };
}

/** Drive the registered prefix handler with a fake Node req/res pair. */
function callRoute(route, { url, method = 'GET', body = '' }) {
  return new Promise((resolve, reject) => {
    const listeners = {};
    const req = {
      url,
      method,
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next: async () => {
            if (sent || !body) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: Buffer.from(body) };
          },
        };
      },
    };
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers || {};
      },
      end(payload) {
        const text = payload ? String(payload) : '';
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: this.statusCode, headers: this.headers, text, json });
      },
    };
    Promise.resolve(route.handler(req, res)).catch(reject);
  });
}

// ---------------------------------------------------------------------------
// 1. manifest integrity
// ---------------------------------------------------------------------------
async function sectionManifest() {
  await check('manifest', 'package.json parses and declares a bundle patch', () => {
    const pkg = readJson('package.json');
    assert(pkg.name === 'dsh-wb2api-panel', 'unexpected package name');
    assert(pkg.type === 'module', 'package must be ESM');
    assert(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'bundle patch missing');
    assert(pkg.dsh.client && pkg.dsh.client.platform === 'web', 'client platform missing');
    return pkg.name + '@' + pkg.version;
  });

  await check('manifest', 'every shipped file exists and is listed', () => {
    const pkg = readJson('package.json');
    for (const file of pkg.files) {
      if (file.includes('*')) continue;
      assert(existsSync(path.join(ROOT, file)), `listed file missing: ${file}`);
    }
    for (const target of Object.values(pkg.exports)) {
      if (target.includes('*')) continue;
      assert(existsSync(path.join(ROOT, target)), `export target missing: ${target}`);
    }
    return pkg.files.join(', ');
  });

  await check('manifest', 'cordis.patch.yml inserts the plugin row with config', () => {
    const yaml = readText('cordis.patch.yml');
    assert(/- insert:/.test(yaml), 'missing insert block');
    assert(/id: wb2api-panel/.test(yaml), 'missing row id');
    assert(/name: dsh-wb2api-panel/.test(yaml), 'missing package name');
    assert(/baseUrl:/.test(yaml) && /panelDir:/.test(yaml), 'missing config defaults');
    return 'row wb2api-panel';
  });

  await check('manifest', 'locale files carry meta + both languages', () => {
    const zh = readJson('locale/zh.json');
    const en = readJson('locale/en.json');
    assert(zh.meta.title && zh.meta.description, 'zh meta incomplete');
    assert(en.meta.title && en.meta.description, 'en meta incomplete');
    assert(zh.meta.title !== en.meta.title, 'locales are not distinct');
    assert(Object.keys(zh.tabs).length === Object.keys(en.tabs).length, 'tab key drift between locales');
    return `${Object.keys(zh.tabs).length} tabs both locales`;
  });

  await check('manifest', 'icon is a valid standalone SVG within limits', () => {
    const svg = readText('icon.svg');
    assert(svg.trim().startsWith('<svg'), 'icon is not SVG');
    assert(/viewBox="0 0 64 64"/.test(svg), 'unexpected viewBox');
    assert(Buffer.byteLength(svg) < 262144, 'icon exceeds 256 KiB');
    assert(!/(?:src|href)\s*=\s*["']https?:/i.test(svg), 'icon must not reference remote assets');
    assert(!/url\(\s*["']?https?:/i.test(svg), 'icon must not reference remote assets');
    return Buffer.byteLength(svg) + ' bytes';
  });
}

// ---------------------------------------------------------------------------
// 2. client module
// ---------------------------------------------------------------------------
async function sectionClientModule(shim) {
  let loaded = null;
  await check('client-module', 'artifact registers one lazy factory under the package id', () => {
    loaded = loadClientModule(shim);
    assert(loaded.registration.id === 'dsh-wb2api-panel', `id mismatch: ${loaded.registration.id}`);
    assert(typeof loaded.registration.factory === 'function', 'factory is not a function');
    return loaded.registration.id;
  });

  await check('client-module', 'factory only requires react and returns a plugin object', () => {
    assert(loaded && loaded.module, 'module did not load');
    assert(Array.isArray(loaded.module.inject) && loaded.module.inject.includes('slots'), 'missing slots inject');
    assert(typeof loaded.module.apply === 'function', 'apply is missing');
    return 'inject=' + loaded.module.inject.join(',');
  });

  await check('client-module', 'apply registers a settings.section page with a live label', () => {
    const registrations = [];
    const ctx = {
      slots: {
        inject(key, callback) {
          assert(key === 'settings.section', 'wrong slot key: ' + key);
          callback();
          return () => {};
        },
        register(options, component) {
          registrations.push({ options, component });
          return () => {};
        },
      },
    };
    loaded.module.apply(ctx);
    assert(registrations.length === 1, 'expected one registration');
    const { options, component } = registrations[0];
    assert(options.name === 'settings.section', 'wrong slot name');
    assert(options.id === 'wb2api-panel', 'wrong slot id');
    assert(typeof options.label === 'function', 'label must be a thunk');
    assert(typeof component === 'function', 'component must be a function');
    const label = options.label();
    assert(typeof label === 'string' && label.length > 0, 'label thunk returned nothing');
    return `id=${options.id} order=${options.order} label=${label}`;
  });

  await check('client-module', 'component is registered into the live slot', () => true);
  return loaded;
}

// ---------------------------------------------------------------------------
// 3. component render per tab, against the live wire
// ---------------------------------------------------------------------------
async function sectionRender(shim, loaded) {
  // Browser code fetches relative URLs; the sandbox already captured the rewriting fetch.
  // retrieve the component registered by apply
  const registrations = [];
  loaded.module.apply({
    slots: {
      inject: (_key, callback) => (callback(), () => {}),
      register: (options, component) => (registrations.push({ options, component }), () => {}),
    },
  });
  const Panel = registrations[0].component;

  let root = null;
  await check('render', 'initial render paints the panel header and overview', async () => {
    root = shim.render(Panel);
    await shim.flush();
    root = shim.render(Panel);
    await shim.flush();
    const body = shim.text(root).join(' ');
    assert(body.includes('WorkBuddy 网关'), 'section title missing');
    assert(body.includes('概览'), 'overview tab missing');
    assert(/账号总数|Version|账号/.test(body), 'overview cards missing');
    return body.length + ' chars rendered';
  });

  const tabs = ['账号', '登录', '任务', '模型', '用量', '诊断', '日志'];
  for (const tab of tabs) {
    await check('render', `tab「${tab}」renders without throwing`, async () => {
      root = shim.render(Panel);
      await shim.press(root, tab);
      root = shim.render(Panel);
      await shim.flush();
      root = shim.render(Panel);
      const body = shim.text(root).join(' ');
      assert(body.length > 0, 'tab rendered empty');
      assert(!/Cannot read|undefined is not|is not a function/.test(body), 'error text leaked into render');
      return `${body.length} chars`;
    });
  }

  await check('render', 'accounts tab lists live pool accounts with actions', async () => {
    root = shim.render(Panel);
    await shim.press(root, '账号');
    root = shim.render(Panel);
    await shim.flush();
    root = shim.render(Panel);
    const body = shim.text(root).join(' ');
    assert(/签到/.test(body), 'check-in action missing');
    assert(/复活|禁用/.test(body), 'state action missing');
    assert(/旅行|保活|活跃/.test(body), 'bulk actions missing');
    return 'actions present';
  });

  await check('render', 'diagnostics tab loads live metrics on demand', async () => {
    root = shim.render(Panel);
    await shim.press(root, '诊断');
    root = shim.render(Panel);
    await shim.flush();
    await shim.press(root, '请求指标');
    root = shim.render(Panel);
    await shim.flush();
    root = shim.render(Panel);
    const body = shim.text(root).join(' ');
    assert(/已完成|Completed/.test(body), 'metrics card missing after load');
    return 'metrics rendered';
  });

  await check('render', 'login tab offers realm choice and link generation', async () => {
    root = shim.render(Panel);
    await shim.press(root, '登录');
    root = shim.render(Panel);
    await shim.flush();
    root = shim.render(Panel);
    const body = shim.text(root).join(' ');
    assert(/国内版|China/.test(body), 'cn realm option missing');
    assert(/生成授权链接|Create authorization/.test(body), 'start button missing');
    return 'login form rendered';
  });
}

// ---------------------------------------------------------------------------
// 4. host module
// ---------------------------------------------------------------------------
async function sectionHost(host) {
  await check('host', 'apply registers the /wb2api prefix route', () => {
    assert(host.captured.routes.length === 1, `expected 1 route, got ${host.captured.routes.length}`);
    const route = host.captured.routes[0];
    assert(route.kind === 'prefix', 'route must be prefix');
    assert(route.path === '/wb2api', 'wrong route path');
    return route.path;
  });

  await check('host', 'registers 13 tools with valid model-facing schemas', () => {
    const names = host.captured.tools.map((tool) => tool.name).sort();
    const expected = [
      'wb2api_accounts',
      'wb2api_bulk',
      'wb2api_clientkeys',
      'wb2api_config',
      'wb2api_diagnostics',
      'wb2api_login',
      'wb2api_logs',
      'wb2api_models',
      'wb2api_security',
      'wb2api_service',
      'wb2api_status',
      'wb2api_tasks',
      'wb2api_usage',
    ];
    assert(JSON.stringify(names) === JSON.stringify(expected), 'tool set mismatch: ' + names.join(','));
    for (const tool of host.captured.tools) {
      assert(tool.description && tool.description.length > 20, `thin description: ${tool.name}`);
      assert(tool.parameters && tool.parameters.type === 'object', `bad parameters schema: ${tool.name}`);
      assert(typeof tool.execute === 'function', `missing execute: ${tool.name}`);
      assert(tool.output && tool.output.schema && typeof tool.output.render === 'function', `bad output: ${tool.name}`);
    }
    return names.length + ' tools';
  });

  const tool = (name) => host.captured.tools.find((entry) => entry.name === name);

  await check('host', 'tool wb2api_status returns lossless JSON', async () => {
    const value = await tool('wb2api_status').execute({}, {});
    const roundTrip = JSON.stringify(value);
    assert(roundTrip && roundTrip.length > 100, 'status payload too small');
    assert(JSON.parse(roundTrip) !== null, 'not JSON');
    assert(!/undefined/.test(roundTrip), 'payload carries undefined');
    return roundTrip.length + ' bytes';
  });

  await check('host', 'tool wb2api_accounts lists the pool', async () => {
    const value = await tool('wb2api_accounts').execute({ action: 'list' }, {});
    assert(value.ok === true, 'not ok: ' + JSON.stringify(value).slice(0, 120));
    assert(Array.isArray(value.accounts) && value.accounts.length > 0, 'no accounts');
    assert(value.accounts[0].uid && typeof value.accounts[0].credits === 'number', 'account shape drifted');
    return value.accounts.length + ' accounts';
  });

  await check('host', 'tool wb2api_models lists models and reports gate capability', async () => {
    const value = await tool('wb2api_models').execute({ action: 'list' }, {});
    assert(value.ok === true && value.count > 0, 'no models');
    assert(value.models[0].id && value.models[0].name, 'model shape drifted');
    assert(typeof value.gateSupported === 'boolean', 'gateSupported flag missing');
    assert(Array.isArray(value.disabled), 'disabled list missing');
    return `${value.count} models, gate=${value.gateSupported}`;
  });

  await check('host', 'tool wb2api_login reaches the region list', async () => {
    const value = await tool('wb2api_login').execute({ action: 'regions' }, {});
    assert(value.ok === true && Array.isArray(value.regions) && value.regions.length >= 7, 'regions missing');
    return value.regions.length + ' regions';
  });

  await check('host', 'tool wb2api_tasks reads the queue', async () => {
    const value = await tool('wb2api_tasks').execute({ action: 'queue' }, {});
    assert(value.ok === true && value.queue && 'running' in value.queue, 'queue shape drifted');
    return 'running=' + value.queue.running;
  });

  await check('host', 'tool wb2api_tasks rejects calls without uid', async () => {
    const value = await tool('wb2api_tasks').execute({ action: 'account' }, {});
    assert(value.ok === false && /uid/.test(value.error), 'missing uid was not rejected');
    return value.error;
  });

  await check('host', 'tool wb2api_diagnostics covers all five kinds', async () => {
    const out = [];
    for (const kind of ['metrics', 'requests', 'packages', 'vouchers', 'probes']) {
      const value = await tool('wb2api_diagnostics').execute({ kind }, {});
      assert(value.status === 200, `${kind} returned ${value.status}`);
      out.push(kind);
    }
    return out.join(',');
  });

  await check('host', 'tool wb2api_usage returns totals', async () => {
    const value = await tool('wb2api_usage').execute({}, {});
    assert(value.ok === true && value.usage && value.usage.totals, 'usage totals missing');
    return 'requests=' + value.usage.totals.requests;
  });

  await check('host', 'tool wb2api_logs returns entries', async () => {
    const value = await tool('wb2api_logs').execute({ limit: 5 }, {});
    assert(value.ok === true && Array.isArray(value.entries), 'entries missing');
    return value.entries.length + ' entries';
  });

  await check('host', 'tool wb2api_config unwraps the {config} envelope', async () => {
    const value = await tool('wb2api_config').execute({ action: 'get' }, {});
    assert(value.ok === true, 'not ok');
    assert(value.config && value.config.listen, 'config envelope was not unwrapped');
    assert(!value.config.config, 'config was double-wrapped');
    return 'listen=' + value.config.listen;
  });

  // 这两个端点在旧二进制上不存在、新二进制上存在。用例不能写死 404：
  // 只要求「要么给数据，要么明确 404」，不许抛错、不许静默假成功。
  await check('host', 'clientkeys / security 要么可用要么明确 404，不许静默', async () => {
    const out = [];
    for (const name of ['wb2api_clientkeys', 'wb2api_security']) {
      const value = await tool(name).execute({}, {});
      if (value.status === 404) {
        assert(value.ok === false, name + ': 404 却报 ok');
        out.push(name + '=404');
      } else {
        assert(value.status === 200 && value.ok === true, name + ': 状态异常 ' + value.status);
        assert(value.data && typeof value.data === 'object', name + ': 200 但无数据');
        out.push(name + '=200');
      }
    }
    return out.join(' ');
  });

  await check('host', 'model gate is supported and round-trips, or is honestly gated', async () => {
    const list = await tool('wb2api_models').execute({ action: 'list' }, {});
    const target = list.models[0];
    assert(target, 'no model available');
    if (!list.gateSupported) {
      const res = await tool('wb2api_models').execute({ action: 'toggle', id: target.id, enabled: false }, {});
      assert(res.ok === false && res.gateSupported === false, 'unsupported gate did not report itself');
      assert(/no per-model gate/.test(res.error), 'unsupported gate message unclear');
      assert(['hidden', 'disabled', null].includes(list.gateConfigKey), 'gateConfigKey 形态异常: ' + list.gateConfigKey);
      return '面板无开关，配置键=' + list.gateConfigKey + '（明确自报，不静默）';
    }
    const off = await tool('wb2api_models').execute({ action: 'toggle', id: target.id, enabled: false }, {});
    assert(off.ok === true, 'disable failed: ' + JSON.stringify(off).slice(0, 160));
    const after = await tool('wb2api_models').execute({ action: 'list' }, {});
    assert(after.disabled.includes(target.id), 'model did not appear in the disabled list');
    const on = await tool('wb2api_models').execute({ action: 'toggle', id: target.id, enabled: true }, {});
    assert(on.ok === true, 're-enable failed');
    const restored = await tool('wb2api_models').execute({ action: 'list' }, {});
    assert(!restored.disabled.includes(target.id), 'model was not restored');
    return target.id + ' toggled and restored';
  });

  await check('host', 'service health reports a running gateway', async () => {
    const value = await tool('wb2api_service').execute({ action: 'health' }, {});
    assert(value.running === true, 'gateway not running');
    assert(value.health && typeof value.health.healthy === 'number', 'health payload missing');
    return `healthy=${value.health.healthy} total=${value.health.total}`;
  });

  const route = host.captured.routes[0];

  await check('proxy', 'GET /wb2api/health returns the snapshot', async () => {
    const res = await callRoute(route, { url: '/wb2api/health' });
    assert(res.status === 200, 'status ' + res.status);
    assert(res.json && res.json.service && res.json.overview, 'snapshot incomplete');
    return 'service.running=' + res.json.service.running;
  });

  await check('proxy', 'GET /wb2api/data serves an allowlisted panel path', async () => {
    const res = await callRoute(route, { url: '/wb2api/data?p=' + encodeURIComponent('/panel/api/overview') });
    assert(res.status === 200 && res.json.data, 'overview proxy failed');
    return 'accounts=' + res.json.data.total;
  });

  await check('proxy', 'GET /wb2api/data refuses a non-allowlisted path', async () => {
    const res = await callRoute(route, { url: '/wb2api/data?p=' + encodeURIComponent('/etc/passwd') });
    assert(res.status === 400, 'expected 400, got ' + res.status);
    assert(/not allowed/.test(res.json.error), 'wrong error text');
    return res.json.error;
  });

  await check('proxy', 'unknown sub-route answers 404 rather than crashing', async () => {
    const res = await callRoute(route, { url: '/wb2api/nope' });
    assert(res.status === 404 && /unknown route/.test(res.json.error), 'unexpected answer');
    return res.json.error;
  });

  await check('proxy', 'POST-only /wb2api/action rejects GET', async () => {
    const res = await callRoute(route, { url: '/wb2api/action?p=' + encodeURIComponent('/panel/api/checkin_all') });
    assert(res.status === 405, 'expected 405, got ' + res.status);
    return '405';
  });

  await check('proxy', 'proc logs exposes the gateway stdout tail', async () => {
    const res = await callRoute(route, { url: '/wb2api/proc?action=logs&lines=5' });
    assert(res.status === 200 && Array.isArray(res.json.lines), 'log tail missing');
    return res.json.lines.length + ' lines';
  });
}

// ---------------------------------------------------------------------------
// 5. live HTTP surface (installed plugin, through the Harness server)
// ---------------------------------------------------------------------------
async function sectionLive() {
  await check('live', 'Harness serves /wb2api/state without an error status', async () => {
    const res = await fetch(BASE + '/wb2api/state');
    assert(res.status === 200, 'status ' + res.status);
    const body = await res.json();
    assert(body.service && body.overview, 'payload incomplete');
    return 'baseUrl=' + body.baseUrl;
  });

  await check('live', 'installed bundle is present in the profile', () => {
    const profile = process.env.DSH_PROFILE_DIR;
    if (!profile) return 'skipped (no profile env)';
    const dir = path.join(profile, 'node_modules', 'dsh-wb2api-panel');
    assert(existsSync(dir), 'package not linked into the profile');
    return dir;
  });

  await check('live', 'gateway health endpoint answers directly', async () => {
    const res = await fetch(PANEL + '/healthz');
    assert(res.status === 200 || res.status === 503, 'unexpected status ' + res.status);
    return 'status=' + res.status;
  });
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
async function main() {
  console.log('dsh-wb2api-panel functional suite');
  console.log('  base=' + BASE + '  gateway=' + PANEL);
  console.log('');

  const shim = createReactShim();

  // The client artifact fetches relative URLs; Node needs an absolute origin.
  // Install this BEFORE the sandbox is created, because the sandbox captures fetch.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    return realFetch(url.startsWith('http') ? url : BASE + url, init);
  };

  await sectionManifest();

  let loaded = null;
  try {
    loaded = loadClientModule(shim);
  } catch (error) {
    check('client-module', 'artifact loads', () => {
      throw error;
    });
  }
  if (loaded) {
    // section 2 uses the already-loaded module; re-run the checks against it
    const registrations = [];
    await check('client-module', 'artifact registers one lazy factory under the package id', () => {
      assert(loaded.registration.id === 'dsh-wb2api-panel', 'id mismatch');
      assert(typeof loaded.registration.factory === 'function', 'factory missing');
      return loaded.registration.id;
    });
    await check('client-module', 'factory only requires react and returns a plugin object', () => {
      assert(Array.isArray(loaded.module.inject) && loaded.module.inject.includes('slots'), 'missing slots inject');
      assert(typeof loaded.module.apply === 'function', 'apply missing');
      return 'inject=' + loaded.module.inject.join(',');
    });
    await check('client-module', 'apply registers a settings.section page with a live label', () => {
      loaded.module.apply({
        slots: {
          inject: (key, callback) => {
            assert(key === 'settings.section', 'wrong slot key: ' + key);
            callback();
            return () => {};
          },
          register: (options, component) => (registrations.push({ options, component }), () => {}),
        },
      });
      assert(registrations.length === 1, 'expected one registration');
      const { options, component } = registrations[0];
      assert(options.id === 'wb2api-panel', 'wrong id');
      assert(typeof options.label === 'function' && options.label().length > 0, 'label thunk broken');
      assert(typeof component === 'function', 'component missing');
      return `id=${options.id} order=${options.order} label=${options.label()}`;
    });
    await sectionRender(shim, loaded);
  }

  const host = await loadHostModule();
  await sectionHost(host);
  await sectionLive();

  // ---------------------------------------------------------------- report
  const sections = [...new Set(results.map((entry) => entry.section))];
  console.log('');
  for (const section of sections) {
    console.log('▎ ' + section);
    for (const entry of results.filter((row) => row.section === section)) {
      const mark = entry.ok ? 'PASS' : 'FAIL';
      console.log(`  [${mark}] ${entry.name}` + (entry.detail ? `  — ${entry.detail}` : ''));
    }
    console.log('');
  }
  const passed = results.filter((entry) => entry.ok).length;
  console.log(`TOTAL ${results.length}  PASS ${passed}  FAIL ${failures}`);

  if (failures > 0) {
    console.log('');
    console.log('FAILURES:');
    for (const entry of results.filter((row) => !row.ok)) {
      console.log(`  - [${entry.section}] ${entry.name}: ${entry.detail}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('suite crashed:', error);
  process.exit(2);
});
