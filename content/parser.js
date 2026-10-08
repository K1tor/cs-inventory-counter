/**
 * Steam 库存历史解析器 —— 纯函数,不依赖 DOM / chrome API。
 * 由 content script、popup、单元测试共同引用(单源,避免分类规则不一致)。
 *
 * 分类依据:库存历史每条记录的「事件说明」文字(如"在《反恐精英2》中开箱"),
 * 覆盖简体中文、繁体中文(汰换合约)与英文,并附带结构启发式(移除多件+获得1件疑似炼金)。
 */
'use strict';

const CATEGORY = {
  CASE: 'case',       // 开箱
  TRADEUP: 'tradeup', // 炼金(升级/汰换合约)
  CAPSULE: 'capsule', // 开胶囊
  OTHER: 'other',     // 市场买卖、交易、掉落等
  UNKNOWN: 'unknown', // 无法识别,待复核
};

const CATEGORY_LABELS = {
  case: '开箱',
  tradeup: '炼金',
  capsule: '开胶囊',
  other: '其他',
  unknown: '待复核',
};

const MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// 顺序敏感:胶囊 > 炼金 > 开箱,避免"打开贴纸胶囊"被误判为开箱
const NOTE_PATTERNS = [
  {
    category: CATEGORY.CAPSULE,
    patterns: [
      /胶囊/,
      /贴纸包|印花包/,
      /capsule/i,
    ],
  },
  {
    category: CATEGORY.TRADEUP,
    patterns: [
      /炼金/,
      /升级合约|汰换合约|升级契约|交换合约/,
      /trade[- ]?up/i,
      /upgrade\s*contract/i,
    ],
  },
  {
    category: CATEGORY.CASE,
    patterns: [
      /开箱|开出/,
      /开[^。\n]{0,12}箱/,          // 打开箱子 / 开了一个箱子 / 开武器箱
      /纪念包|纪念品包|souvenir/i,
      /unbox/i,
      /opened\s+(a\s+|the\s+)?(weapon\s+)?(case|container)/i,
      /case\s+opening/i,
    ],
  },
];

/**
 * 根据事件说明与物品列表分类。
 * @param {string|null} note    事件说明文字
 * @param {string[]} [added]    获得的物品名
 * @param {string[]} [removed]  移除的物品名
 * @returns {{category: string, hint: string|null}}
 */
function classify(note, added, removed) {
  const n = String(note || '').trim();
  if (n) {
    for (const { category, patterns } of NOTE_PATTERNS) {
      for (const re of patterns) {
        if (re.test(n)) return { category, hint: null };
      }
    }
    return { category: CATEGORY.OTHER, hint: null };
  }
  // 说明为空:移除多件、获得 1 件 → 疑似炼金
  if (Array.isArray(removed) && removed.length >= 5 && Array.isArray(added) && added.length === 1) {
    return { category: CATEGORY.UNKNOWN, hint: 'tradeup' };
  }
  return { category: CATEGORY.UNKNOWN, hint: null };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * 解析日期/时间文本,返回 {date:'YYYY-MM-DD'|null, time:'HH:mm'|null}。
 * 支持:2024年5月1日 / May 1, 2024 / 5月1日(补当年) / 2024-05-01 / 下午3:45 / 3:45pm
 */
function parseDateText(dateText, timeText) {
  const d = String(dateText || '').trim();
  let date = null;

  let m = d.match(/(\d{4})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/);
  if (m) {
    date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  } else {
    m = d.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    const enMonth = m && MONTHS_EN[m[1].toLowerCase()];
    if (enMonth) {
      date = `${m[3]}-${pad(enMonth)}-${pad(m[2])}`;
    } else {
      m = d.match(/(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/);
      if (m) {
        const now = new Date();
        date = `${now.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
      } else {
        m = d.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (m) date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
      }
    }
  }

  const t = String(timeText || '').trim();
  let time = null;
  let tm = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (tm) {
    let h = parseInt(tm[1], 10) % 12;
    if (/pm/i.test(tm[3])) h += 12;
    time = `${pad(h)}:${tm[2]}`;
  } else {
    tm = t.match(/([上下]午)\s*(\d{1,2}):(\d{2})/);
    if (tm) {
      let h = parseInt(tm[2], 10);
      if (tm[1] === '下午' && h < 12) h += 12;
      if (tm[1] === '上午' && h === 12) h = 0;
      time = `${pad(h)}:${tm[3]}`;
    } else {
      tm = t.match(/(\d{1,2}):(\d{2})/);
      if (tm) time = `${pad(tm[1])}:${tm[2]}`;
    }
  }
  return { date, time };
}

/**
 * 从整段描述文本中剔除物品名行,得到事件说明。
 * 用于说明行与物品行未分开的兜底场景。
 */
function extractNote(descText, itemNames) {
  const names = new Set((itemNames || []).map((n) => String(n || '').trim()).filter(Boolean));
  const lines = String(descText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const kept = lines.filter((line) => {
    const l = line.replace(/^[+\-]\s*/, '').trim();
    if (!l) return false;
    return !names.has(l);
  });
  return kept.join(' ');
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
function monthOf(dateStr) {
  return dateStr && dateStr.length >= 7 ? dateStr.slice(0, 7) : null;
}

/** 生成去重用稳定 id */
function hashId(parts) {
  let h = 5381;
  const s = (parts || []).join('|');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(36);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATEGORY,
    CATEGORY_LABELS,
    NOTE_PATTERNS,
    MONTHS_EN,
    classify,
    parseDateText,
    extractNote,
    monthOf,
    hashId,
  };
}
