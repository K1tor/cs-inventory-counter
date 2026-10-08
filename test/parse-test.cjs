/**
 * 解析器单元测试:node test/parse-test.cjs
 */
'use strict';
const assert = require('assert');
const {
  CATEGORY,
  classify,
  parseDateText,
  extractNote,
  monthOf,
} = require('../content/parser.js');

let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  - ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL- ' + name);
    console.error('        ' + (e && e.message));
  }
}

function expectCategory(note, added, removed, want, hint) {
  const r = classify(note, added, removed);
  assert.strictEqual(r.category, want, `note="${note}" 期望 ${want},得到 ${r.category}`);
  if (hint !== undefined) assert.strictEqual(r.hint, hint);
}

console.log('== 中文说明分类 ==');
t('中文开箱', () => expectCategory('在《反恐精英2》中开箱', ['AK-47 | 红线'], [], CATEGORY.CASE));
t('中文打开箱子', () => expectCategory('在《反恐精英2》中打开了一个箱子', ['M4A4 | 龙王'], [], CATEGORY.CASE));
t('中文开胶囊', () => expectCategory('在《反恐精英2》中打开贴纸胶囊', ['印花 | XX'], [], CATEGORY.CAPSULE));
t('中文炼金(升级合约)', () => expectCategory('在《反恐精英2》中使用升级合约', ['AWP | 野火'], ['x', 'y', 'z', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], CATEGORY.TRADEUP));
t('中文炼金(汰换合约)', () => expectCategory('在《反恐精英2》中使用汰换合约', ['USP 消音版 | 不锈钢'], [], CATEGORY.TRADEUP));
t('中文市场购买', () => expectCategory('在社区市场购买', ['印花 | 胶囊'], [], CATEGORY.OTHER));
t('中文市场出售', () => expectCategory('在社区市场出售', [], ['AK-47 | 红线'], CATEGORY.OTHER));
t('中文交易', () => expectCategory('与 小明 交易', ['M4A1 消音版 | 梦魇'], [], CATEGORY.OTHER));
t('中文掉落', () => expectCategory('游戏掉落', ['武器箱'], [], CATEGORY.OTHER));
t('说明为空+移除10获得1 → 待复核疑似炼金', () =>
  expectCategory('', ['AWP | 野火'], ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], CATEGORY.UNKNOWN, 'tradeup'));
t('说明为空+无结构线索 → 待复核', () =>
  expectCategory('', ['AWP | 野火'], [], CATEGORY.UNKNOWN, null));

console.log('== 英文说明分类 ==');
t('英文开箱', () => expectCategory('Unboxed in Counter-Strike 2', ['AK-47 | Redline'], [], CATEGORY.CASE));
t('英文打开箱子', () => expectCategory('Opened a weapon case in Counter-Strike 2', ['M4A4 | Asiimov'], [], CATEGORY.CASE));
t('英文开胶囊', () => expectCategory('Opened a sticker capsule in Counter-Strike 2', ['Sticker | XX'], [], CATEGORY.CAPSULE));
t('英文炼金', () => expectCategory('Used an upgrade contract in Counter-Strike 2', ['AWP | Asiimov'], [], CATEGORY.TRADEUP));
t('英文 Trade Up', () => expectCategory('Trade Up Contract', ['USP-S | Kill Confirmed'], [], CATEGORY.TRADEUP));
t('英文市场购买', () => expectCategory('Purchased from Community Market', ['Sticker Capsule'], [], CATEGORY.OTHER));
t('英文市场出售', () => expectCategory('Sold on Community Market', [], ['AK-47 | Redline'], CATEGORY.OTHER));
t('英文交易', () => expectCategory('Traded with Xiaoming', ['M4A1-S | Nightmare'], [], CATEGORY.OTHER));
t('英文掉落', () => expectCategory('Playtime Drop', ['Weapon Case'], [], CATEGORY.OTHER));

console.log('== 日期时间解析 ==');
t('中文日期+下午时间', () => {
  const r = parseDateText('2024年5月1日', '下午3:45');
  assert.strictEqual(r.date, '2024-05-01');
  assert.strictEqual(r.time, '15:45');
});
t('英文日期+pm', () => {
  const r = parseDateText('May 1, 2024', '3:45pm');
  assert.strictEqual(r.date, '2024-05-01');
  assert.strictEqual(r.time, '15:45');
});
t('英文 12:15am', () => {
  const r = parseDateText('May 1, 2024', '12:15am');
  assert.strictEqual(r.time, '00:15');
});
t('中文日期+上午', () => {
  const r = parseDateText('2024年12月5日', '上午9:05');
  assert.strictEqual(r.date, '2024-12-05');
  assert.strictEqual(r.time, '09:05');
});
t('缺年份补当前年', () => {
  const r = parseDateText('5月1日', '');
  assert.strictEqual(r.date, `${new Date().getFullYear()}-05-01`);
});
t('ISO 日期', () => {
  const r = parseDateText('2024-05-01', '15:30');
  assert.strictEqual(r.date, '2024-05-01');
  assert.strictEqual(r.time, '15:30');
});
t('空输入', () => {
  const r = parseDateText('', '');
  assert.strictEqual(r.date, null);
  assert.strictEqual(r.time, null);
});

console.log('== 说明提取(物品名污染防护) ==');
t('剔除物品行后得到市场购买说明', () => {
  const note = extractNote('+印花 | 胶囊\n在社区市场购买', ['印花 | 胶囊']);
  assert.strictEqual(note, '在社区市场购买');
});
t('说明行保留', () => {
  const note = extractNote('+AK-47 | 红线 (久经沙场)\n在《反恐精英2》中开箱', ['AK-47 | 红线 (久经沙场)']);
  assert.strictEqual(note, '在《反恐精英2》中开箱');
});

console.log('== 工具 ==');
t('monthOf', () => assert.strictEqual(monthOf('2024-05-01'), '2024-05'));

console.log('');
console.log(`结果:${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
