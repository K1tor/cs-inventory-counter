/**
 * CS 开箱统计助手 —— 弹窗逻辑
 * 依赖:../content/parser.js(共享分类与日期解析)
 */
'use strict';

const EVENTS_KEY = 'csCounterEvents';
const STATE_KEY = 'csCounterScanState';
const HISTORY_URL = 'https://steamcommunity.com/my/inventoryhistory/';

let events = [];
let scanState = {};
let reviewFilter = 'all';
let reviewShown = 200;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function storageGet(key) {
  return new Promise((r) => chrome.storage.local.get(key, (o) => r(o[key])));
}
function storageSet(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function catLabel(c) {
  return CATEGORY_LABELS[c] || String(c);
}

function eventSortKey(e) {
  if (e.ts) return e.ts;
  if (e.date) {
    const t = new Date(`${e.date}T${e.time || '00:00'}:00`).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}
function sortEventsDesc(list) {
  return [...list].sort((a, b) => eventSortKey(b) - eventSortKey(a));
}

async function loadData() {
  const [ev, st] = await Promise.all([storageGet(EVENTS_KEY), storageGet(STATE_KEY)]);
  events = Array.isArray(ev) ? ev : [];
  scanState = st || {};
}

async function save() {
  await storageSet({ [EVENTS_KEY]: events });
  renderAll();
}

function counts() {
  const c = { case: 0, tradeup: 0, capsule: 0, unknown: 0, total: 0 };
  for (const e of events) {
    if (!e.included) continue;
    if (c[e.category] !== undefined) c[e.category]++;
    c.total++;
  }
  return c;
}

// ---------- 渲染 ----------
function renderStats() {
  const c = counts();
  $('#num-case').textContent = c.case;
  $('#num-tradeup').textContent = c.tradeup;
  $('#num-capsule').textContent = c.capsule;
  $('#sum-total').textContent = c.total;
  $('#sum-unknown').textContent = c.unknown;
  renderMonthly();
  renderRecent();
  renderScanState();
}

function renderMonthly() {
  const byMonth = new Map();
  for (const e of events) {
    if (!e.included) continue;
    const m = monthOf(e.date) || '未知';
    if (!byMonth.has(m)) byMonth.set(m, { case: 0, tradeup: 0, capsule: 0, total: 0 });
    const r = byMonth.get(m);
    if (e.category === 'case') r.case++;
    else if (e.category === 'tradeup') r.tradeup++;
    else if (e.category === 'capsule') r.capsule++;
    if (e.category !== 'unknown') r.total++;
  }
  const wrap = $('#monthly');
  if (byMonth.size === 0) {
    wrap.innerHTML = '<div class="empty">暂无数据,点击「开始扫描」读取 Steam 库存历史</div>';
    return;
  }
  const months = [...byMonth.keys()].sort((a, b) =>
    a === '未知' ? 1 : b === '未知' ? -1 : b.localeCompare(a)
  );
  let html = '<table><tr><th>月份</th><th>开箱</th><th>炼金</th><th>开胶囊</th><th>合计</th></tr>';
  for (const m of months) {
    const r = byMonth.get(m);
    html += `<tr><td>${escapeHtml(m)}</td><td>${r.case}</td><td>${r.tradeup}</td><td>${r.capsule}</td><td class="m-month-total">${r.total}</td></tr>`;
  }
  wrap.innerHTML = html + '</table>';
}

function renderRecent() {
  const list = sortEventsDesc(events).slice(0, 15);
  const el = $('#recent');
  if (list.length === 0) {
    el.innerHTML = '<div class="empty">暂无记录</div>';
    return;
  }
  el.innerHTML = list.map((e) => `
    <div class="r-item">
      <span class="r-cat cat-${e.category}">${catLabel(e.category)}</span>
      <div class="r-main">
        <div class="r-note">${escapeHtml(e.note || '无说明')}</div>
        <div class="r-items">${escapeHtml(e.added.join('、') || (e.removed.length ? `移除 ${e.removed.length} 件` : ''))}</div>
      </div>
      <span class="r-date">${escapeHtml(e.date || '')}</span>
    </div>`).join('');
}

// ---------- 产物统计 ----------
function aggregateProducts() {
  const groups = {
    case: { label: '开箱产物', map: new Map() },
    tradeup: { label: '炼金产物', map: new Map() },
    capsule: { label: '开胶囊产物', map: new Map() },
  };
  for (const e of events) {
    if (!e.included) continue;
    const g = groups[e.category];
    if (!g) continue;
    (e.added || []).forEach((name, i) => {
      if (!name) return;
      let cur = g.map.get(name);
      if (!cur) {
        cur = { name, count: 0, icon: null, lastDate: null };
        g.map.set(name, cur);
      }
      cur.count++;
      if (!cur.icon && e.addedIcons && e.addedIcons[i]) cur.icon = e.addedIcons[i];
      if (e.date && (!cur.lastDate || e.date > cur.lastDate)) cur.lastDate = e.date;
    });
  }
  return groups;
}

function renderProducts() {
  const groups = aggregateProducts();
  const wrap = $('#products');
  const blocks = [];
  for (const key of ['case', 'tradeup', 'capsule']) {
    const g = groups[key];
    const items = [...g.map.values()].sort(
      (a, b) => b.count - a.count || String(b.lastDate || '').localeCompare(String(a.lastDate || ''))
    );
    if (items.length === 0) continue;
    const total = items.reduce((s, it) => s + it.count, 0);
    const shown = items.slice(0, 100);
    blocks.push(
      `<h4 class="prod-title">${g.label}<span class="prod-kinds">${items.length} 种 / ${total} 件</span></h4>`
    );
    blocks.push(
      shown
        .map(
          (it) => `
      <div class="prod-item">
        ${it.icon ? `<img class="prod-icon" src="${escapeHtml(it.icon)}" alt="" loading="lazy" />` : '<span class="prod-icon prod-icon-empty"></span>'}
        <a class="prod-name" target="_blank" rel="noreferrer" href="https://steamcommunity.com/market/search?q=${encodeURIComponent(it.name)}&appid=730" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</a>
        <span class="prod-count">×${it.count}</span>
        <span class="prod-date">${escapeHtml(it.lastDate || '')}</span>
      </div>`
        )
        .join('')
    );
    if (items.length > shown.length) {
      blocks.push(`<div class="empty">仅显示前 100 种,共 ${items.length} 种</div>`);
    }
  }
  wrap.innerHTML = blocks.length
    ? blocks.join('')
    : '<div class="empty">暂无产物数据,先扫描库存历史</div>';
}

function renderScanState() {
  const prog = $('#scan-progress');
  const st = $('#scan-state');
  if (scanState.phase === 'running') {
    prog.hidden = false;
    prog.textContent = `扫描中… 已加载 ${scanState.scanned || 0} 行`;
    st.textContent = '扫描中';
    st.style.color = '#ffd166';
  } else {
    prog.hidden = true;
    st.textContent = scanState.phase === 'done' ? '已扫描完成' : '';
    st.style.color = '';
  }
}

// ---------- 复核 ----------
function filteredEvents() {
  const list = sortEventsDesc(events);
  if (reviewFilter === 'all') return list;
  return list.filter((e) => e.category === reviewFilter);
}

function renderReview() {
  const list = filteredEvents();
  const shown = list.slice(0, reviewShown);
  const el = $('#review-list');
  if (shown.length === 0) {
    el.innerHTML = '<div class="empty">该分类下暂无记录</div>';
    $('#btn-more').hidden = true;
    return;
  }
  el.innerHTML = shown.map((e) => `
    <div class="rv-item">
      <div class="rv-top">
        <span class="rv-note">${escapeHtml(e.note || '无说明')}</span>
        <span class="rv-date">${escapeHtml((e.date || '') + ' ' + (e.time || ''))}</span>
      </div>
      ${e.hint === 'tradeup' ? '<div class="rv-hint">疑似炼金(移除多件+获得1件),请确认分类</div>' : ''}
      <div class="rv-items">获得:${escapeHtml(e.added.join('、') || '无')}${e.removed.length ? '<br>移除:' + escapeHtml(e.removed.join('、')) : ''}</div>
      <div class="rv-bottom">
        <select class="rv-cat-sel" data-id="${escapeHtml(e.id)}">
          ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${k}" ${e.category === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <label class="rv-include"><input type="checkbox" class="rv-inc" data-id="${escapeHtml(e.id)}" ${e.included ? 'checked' : ''} />计入</label>
      </div>
    </div>`).join('');
  $('#btn-more').hidden = list.length <= reviewShown;
}

function renderAll() {
  renderStats();
  renderProducts();
  renderReview();
}

// ---------- 手动加减 ----------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function addManual(cat) {
  events.push({
    id: 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    date: todayStr(),
    time: nowTime(),
    category: cat,
    hint: null,
    note: '手动添加',
    added: ['手动记录'],
    removed: [],
    included: true,
    manual: true,
  });
  await save();
}

async function removeManual(cat) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].manual && events[i].category === cat) {
      events.splice(i, 1);
      await save();
      return;
    }
  }
}

// ---------- 扫描 ----------
async function ensureScanTab() {
  const tabs = await chrome.tabs.query({ url: '*://steamcommunity.com/*inventoryhistory*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0].id;
  }
  const tab = await chrome.tabs.create({ url: HISTORY_URL });
  return tab.id;
}

async function startScan() {
  const tabId = await ensureScanTab();
  for (let i = 0; i < 20; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'CS_COUNTER_START' });
      if (resp && resp.ok) break;
    } catch (e) {
      /* 页面尚未就绪,重试 */
    }
    await sleep(500);
  }
}

// ---------- 导出 CSV ----------
function exportCSV() {
  const rows = [['日期', '时间', '类别', '计入统计', '说明', '获得物品', '移除物品']];
  const sorted = sortEventsDesc(events).reverse();
  for (const e of sorted) {
    rows.push([
      e.date || '',
      e.time || '',
      catLabel(e.category),
      e.included ? '是' : '否',
      e.note || '',
      e.added.join('; '),
      e.removed.join('; '),
    ]);
  }
  const csv = '\ufeff' + rows.map((r) =>
    r.map((c) => {
      c = String(c == null ? '' : c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(',')
  ).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cs-开箱统计-${todayStr()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + t.dataset.tab));
    })
  );

  $$('.mini').forEach((b) =>
    b.addEventListener('click', () => {
      const cat = b.dataset.cat;
      if (b.dataset.op === 'plus') addManual(cat);
      else removeManual(cat);
    })
  );

  $('#btn-scan').addEventListener('click', startScan);
  $('#btn-csv').addEventListener('click', exportCSV);
  $('#btn-clear').addEventListener('click', async () => {
    if (!confirm('确定清空全部统计数据吗?此操作不可恢复。')) return;
    events = [];
    await save();
  });

  $('#filters').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    reviewFilter = chip.dataset.f;
    reviewShown = 200;
    renderReview();
  });

  $('#btn-more').addEventListener('click', () => {
    reviewShown += 200;
    renderReview();
  });

  $('#review-list').addEventListener('change', async (ev) => {
    const id = ev.target.dataset.id;
    if (!id) return;
    const e = events.find((x) => x.id === id);
    if (!e) return;
    if (ev.target.classList.contains('rv-cat-sel')) {
      e.category = ev.target.value;
      e.hint = null;
    } else if (ev.target.classList.contains('rv-inc')) {
      e.included = ev.target.checked;
    }
    await save();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[EVENTS_KEY]) {
      events = changes[EVENTS_KEY].newValue || [];
      renderAll();
    }
    if (changes[STATE_KEY]) {
      scanState = changes[STATE_KEY].newValue || {};
      renderScanState();
    }
  });
}

// ---------- 启动 ----------
(async () => {
  bindEvents();
  await loadData();
  renderAll();
})().catch((err) => {
  $('#sum-unknown').textContent = '加载失败:' + err.message;
});
