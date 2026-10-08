/**
 * CS 开箱统计助手 —— 库存历史页内容脚本
 * 1) 注入悬浮面板(开始/停止扫描、实时计数)
 * 2) 扫描时自动滚动页面,让 Steam 自行加载全部历史记录
 * 3) 解析 .tradehistoryrow 行,分类去重后合并写入 chrome.storage.local
 * 依赖:parser.js(先于本文件注入,共享作用域)
 */
'use strict';
(() => {
  if (window.__csCounterInjected) return;
  window.__csCounterInjected = true;

  const EVENTS_KEY = 'csCounterEvents';
  const STATE_KEY = 'csCounterScanState';
  const MAX_ROWS = 30000; // 扫描行数保护上限
  const WAIT_MS = 700;    // 每轮滚动等待
  const MAX_STAGNANT = 14; // 连续无新行则视为到达末尾

  let events = [];        // 内存中的合并后事件列表
  let parsedIds = new Set();
  let scanRunning = false;
  let stopRequested = false;
  let savePending = false;

  // ---------- 工具 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el ? (el.textContent || '').trim() : '');
  const rowCount = () => document.querySelectorAll('.tradehistoryrow').length;

  function storageGet(key) {
    return new Promise((resolve) => chrome.storage.local.get(key, (o) => resolve(o[key])));
  }
  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  // ---------- 行解析 ----------
  function parseRow(row) {
    const descEl = row.querySelector('.tradehistory_event_description');
    if (!descEl) return null;

    const dateText = text(row.querySelector('.tradehistory_date'));
    const timeText = text(row.querySelector('.tradehistory_timestamp'));

    const added = [];
    const addedIcons = [];
    const removed = [];
    const removedIcons = [];

    const pushItem = (dir, name, icon) => {
      if (!name) return;
      if (dir === 'added') {
        added.push(name);
        addedIcons.push(icon || null);
      } else {
        removed.push(name);
        removedIcons.push(icon || null);
      }
    };

    // 优先按"每个物品一个容器"的结构提取(可同时拿到物品图标)
    const containers = descEl.querySelectorAll(
      '.tradehistory_received_item, .tradehistory_given_item, [class*="received_item"], [class*="given_item"]'
    );
    if (containers.length > 0) {
      for (const c of Array.from(containers)) {
        const a = c.querySelector('a.history_item');
        if (!a) continue;
        const name = (a.textContent || '').trim().replace(/^[+\-]\s*/, '');
        const img = c.querySelector('img');
        const icon = img ? img.getAttribute('src') || img.src : null;
        const dir =
          /received/.test(c.className || '') || /\breceived\b/.test(a.id || '') ? 'added' : 'removed';
        pushItem(dir, name, icon);
      }
    } else {
      for (const a of Array.from(descEl.querySelectorAll('a.history_item'))) {
        const name = (a.textContent || '').trim().replace(/^[+\-]\s*/, '');
        const img = a.querySelector('img');
        const icon = img ? img.getAttribute('src') || img.src : null;
        pushItem(/\breceived\b/.test(a.id || '') ? 'added' : 'removed', name, icon);
      }
    }

    let note = '';
    if (added.length + removed.length > 0) {
      const parts = [];
      for (const child of Array.from(descEl.children)) {
        if (child.querySelector && child.querySelector('a.history_item')) continue;
        const t = (child.textContent || '').trim();
        if (t) parts.push(t);
      }
      note = parts.join(' ');
    }
    if (!note) {
      const names = [...added, ...removed];
      note = extractNote(descEl.innerText || '', names);
      if (!note) {
        // 连物品行都没有解析到:按 +/- 行兜底
        const lines = (descEl.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        for (const l of lines) {
          if (/^\+/.test(l)) added.push(l.replace(/^\+/, '').trim());
          else if (/^-/.test(l)) removed.push(l.replace(/^-/, '').trim());
        }
        note = extractNote(descEl.innerText || '', [...added, ...removed]);
      }
    }

    const { date, time } = parseDateText(dateText, timeText);
    let ts = null;
    if (date) {
      const t = new Date(`${date}T${time || '00:00'}:00`);
      if (!isNaN(t.getTime())) ts = t.getTime();
    }

    const id =
      row.getAttribute('id') && row.getAttribute('id').trim()
        ? row.getAttribute('id').trim()
        : hashId(['row', date, time, note, added.join(','), removed.join(',')]);

    const { category, hint } = classify(note, added, removed);
    return {
      id,
      ts,
      date,
      time,
      category,
      hint,
      note,
      added,
      addedIcons,
      removed,
      removedIcons,
      included: true,
      manual: false,
    };
  }

  function mergeEvents(existing, incoming) {
    const map = new Map((existing || []).map((e) => [e.id, e]));
    for (const inc of incoming) {
      const old = map.get(inc.id);
      if (old) {
        // 自动升级"待复核"为明确分类,但绝不覆盖用户手动改过的分类
        if (
          !old.manual &&
          (old.category === CATEGORY.UNKNOWN || old.category === 'unknown') &&
          inc.category !== CATEGORY.UNKNOWN &&
          inc.category !== 'unknown'
        ) {
          old.category = inc.category;
          old.hint = inc.hint;
        }
        if (!old.note) old.note = inc.note;
        if (old.added.length === 0) old.added = inc.added;
        if (old.removed.length === 0) old.removed = inc.removed;
        if ((!old.addedIcons || old.addedIcons.length === 0) && inc.addedIcons) old.addedIcons = inc.addedIcons;
        if ((!old.removedIcons || old.removedIcons.length === 0) && inc.removedIcons) old.removedIcons = inc.removedIcons;
        if (!old.date) old.date = inc.date;
        if (!old.time) old.time = inc.time;
        if (inc.ts && !old.ts) old.ts = inc.ts;
      } else {
        map.set(inc.id, inc);
      }
    }
    return Array.from(map.values());
  }

  // ---------- 面板 UI ----------
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'cs-counter-panel';
    panel.innerHTML = `
      <div class="csc-head">
        <span class="csc-title">CS 开箱统计助手</span>
        <button class="csc-collapse" title="收起/展开">–</button>
      </div>
      <div class="csc-body">
        <div class="csc-counts">
          <div class="csc-count csc-case"><span class="csc-num" data-c="case">0</span>开箱</div>
          <div class="csc-count csc-tradeup"><span class="csc-num" data-c="tradeup">0</span>炼金</div>
          <div class="csc-count csc-capsule"><span class="csc-num" data-c="capsule">0</span>开胶囊</div>
        </div>
        <div class="csc-sub"><span id="csc-rows">已加载 0 行</span><span id="csc-unknown">待复核 0</span></div>
        <div class="csc-status" id="csc-status">就绪</div>
        <div class="csc-actions">
          <button id="csc-start" class="csc-btn csc-btn-primary">开始扫描</button>
          <button id="csc-stop" class="csc-btn" disabled>停止</button>
        </div>
        <div class="csc-hint">点击浏览器工具栏图标查看统计、复核与导出</div>
      </div>`;
    document.body.appendChild(panel);

    const collapsed = panel.querySelector('.csc-collapse');
    collapsed.addEventListener('click', () => {
      const body = panel.querySelector('.csc-body');
      const hide = body.style.display !== 'none';
      body.style.display = hide ? 'none' : '';
      collapsed.textContent = hide ? '+' : '–';
    });

    panel.querySelector('#csc-start').addEventListener('click', startScan);
    panel.querySelector('#csc-stop').addEventListener('click', stopScan);
    return panel;
  }

  function updatePanel() {
    const counts = { case: 0, tradeup: 0, capsule: 0, unknown: 0 };
    for (const e of events) {
      if (!e.included) continue;
      if (e.category in counts) counts[e.category]++;
    }
    document.querySelectorAll('.csc-num').forEach((el) => {
      el.textContent = String(counts[el.dataset.c] || 0);
    });
    const rowsEl = document.getElementById('csc-rows');
    if (rowsEl) rowsEl.textContent = `已加载 ${parsedIds.size} 行`;
    const unkEl = document.getElementById('csc-unknown');
    if (unkEl) unkEl.textContent = `待复核 ${counts.unknown}`;
    const startBtn = document.getElementById('csc-start');
    const stopBtn = document.getElementById('csc-stop');
    if (startBtn) startBtn.disabled = scanRunning;
    if (stopBtn) stopBtn.disabled = !scanRunning;
  }

  function setStatus(msg, kind) {
    const el = document.getElementById('csc-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'csc-status' + (kind ? ' csc-' + kind : '');
  }

  async function setScanState(phase) {
    const state = {
      phase,
      scanned: parsedIds.size,
      totalEvents: events.length,
      at: Date.now(),
    };
    await storageSet({ [STATE_KEY]: state });
  }

  // ---------- 扫描 ----------
  function parseNewRows() {
    const rows = document.querySelectorAll('.tradehistoryrow');
    const fresh = [];
    for (const row of rows) {
      // 跳过不含事件描述的行(如日期分组行)
      if (!row.querySelector('.tradehistory_event_description')) continue;
      const parsed = parseRow(row);
      if (!parsed) continue;
      const dedupeKey = parsed.id;
      if (parsedIds.has(dedupeKey)) continue;
      parsedIds.add(dedupeKey);
      fresh.push(parsed);
    }
    if (fresh.length === 0) return 0;
    const stored = events;
    events = mergeEvents(stored, fresh);
    // 异步保存(节流)
    if (!savePending) {
      savePending = true;
      setTimeout(async () => {
        savePending = false;
        try {
          await storageSet({ [EVENTS_KEY]: events });
        } catch (err) {
          setStatus('保存失败:' + err.message, 'err');
        }
      }, 300);
    }
    return fresh.length;
  }

  function tryClickShowMore() {
    const candidates = Array.from(document.querySelectorAll('a, button')).filter((el) =>
      /show more|load more|加载更多|查看更多|more/i.test(el.textContent || '')
    );
    for (const el of candidates.slice(0, 3)) {
      try { el.click(); } catch (e) { /* ignore */ }
    }
  }

  async function startScan() {
    if (scanRunning) return;
    if (rowCount() === 0) {
      setStatus('未发现历史记录,请确认已登录且页面为 /inventoryhistory', 'err');
      return;
    }
    scanRunning = true;
    stopRequested = false;
    updatePanel();
    setStatus('正在扫描…', 'run');
    await setScanState('running');

    let stagnant = 0;
    try {
      while (scanRunning && !stopRequested) {
        const before = rowCount();
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(WAIT_MS);
        const addedNow = parseNewRows();
        const after = rowCount();

        if (after > before) {
          stagnant = 0;
        } else {
          stagnant++;
          if (stagnant === 3 || stagnant === 6 || stagnant === 9) tryClickShowMore();
          if (stagnant >= MAX_STAGNANT) break;
        }
        if (rowCount() >= MAX_ROWS) break;

        setStatus(`正在扫描… 已加载 ${parsedIds.size} 行`, 'run');
        updatePanel();
      }
    } catch (err) {
      setStatus('扫描出错:' + err.message, 'err');
    }

    scanRunning = false;
    updatePanel();
    if (stopRequested) {
      setStatus('已停止(进度已保存,可再次点击继续)', 'idle');
      await setScanState('stopped');
    } else {
      setStatus(`扫描完成,共解析 ${parsedIds.size} 行`, 'ok');
      await setScanState('done');
    }
  }

  function stopScan() {
    stopRequested = true;
    scanRunning = false;
    setStatus('正在停止…', 'idle');
    updatePanel();
  }

  // ---------- 消息 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'CS_COUNTER_START') {
      startScan();
      sendResponse({ ok: true, running: true });
    } else if (msg.type === 'CS_COUNTER_STOP') {
      stopScan();
      sendResponse({ ok: true });
    } else if (msg.type === 'CS_COUNTER_STATE') {
      sendResponse({ running: scanRunning, scanned: parsedIds.size });
    }
    return false;
  });

  // ---------- 初始化 ----------
  async function init() {
    buildPanel();
    const stored = (await storageGet(EVENTS_KEY)) || [];
    events = Array.isArray(stored) ? stored : [];
    // 已解析的行同步进 parsedIds,避免重复入列(不重复解析,只标记已有 id)
    for (const e of events) parsedIds.add(e.id);
    updatePanel();

    // 清理上次异常退出残留的运行状态
    const st = (await storageGet(STATE_KEY)) || {};
    if (st.phase === 'running') await setScanState('stopped');

    if (rowCount() === 0) {
      const onLogin = document.querySelector('#loginForm, .newmodal');
      if (onLogin) setStatus('请先登录 Steam 账号', 'err');
      else setStatus('未发现历史记录行,请确认当前页面是你的库存历史页', 'err');
    } else {
      setStatus(`已就绪,当前页已加载 ${rowCount()} 行记录`, 'idle');
    }
  }

  init().catch((err) => {
    setStatus('初始化失败:' + err.message, 'err');
  });
})();
