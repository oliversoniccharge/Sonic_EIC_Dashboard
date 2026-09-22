import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/analysis-statistics.js', import.meta.url), 'utf8');
const { summarise } = vm.runInNewContext(source + '; MeterStatistics');
const channel = (days, intervalLen = 720) => ({
  unit: 'KWH', intervalLen,
  data: Object.fromEntries(days.map((values, i) => [String(20260101 + i), { values }])),
});

test('mean and median use numeric ordering and average both middle observations', () => {
  const stats = summarise(channel([[12, 36], [24, 120]]));
  assert.equal(stats.demand.mean, 4);
  assert.equal(stats.demand.median, 2.5);
  assert.equal(stats.dailyEnergy.mean, 96);
  assert.equal(stats.dailyEnergy.median, 96);
});

test('odd daily median differs from the mean with an outlier', () => {
  const stats = summarise(channel([[12, 12], [24, 24], [120, 120]]));
  assert.equal(stats.dailyEnergy.mean, 104);
  assert.equal(stats.dailyEnergy.median, 48);
});

test('missing, non-finite and partial days do not dilute statistics; real zero remains', () => {
  const stats = summarise(channel([[0, 24], [null, 48], [12], [NaN, Infinity]]));
  assert.equal(stats.demand.mean, 1.75);
  assert.equal(stats.demand.median, 1.5);
  assert.equal(stats.observedIntervals, 4);
  assert.equal(stats.completeDays, 1);
  assert.equal(stats.incompleteDays, 3);
  assert.equal(stats.dailyEnergy.mean, 24);
  assert.equal(stats.dailyEnergy.median, 24);
});

test('empty selection and unavailable energy return unknown, not zero', () => {
  for (const input of [channel([]), channel([[null, null]]), null,
    { ...channel([[12, 12]]), unit: 'KVARH' }, channel([[12]], 0)]) {
    const stats = summarise(input);
    assert.equal(stats.demand.mean, null);
    assert.equal(stats.demand.median, null);
    assert.equal(stats.dailyEnergy.mean, null);
    assert.equal(stats.dailyEnergy.median, null);
  }
});

test('kWh converts to demand using the actual interval duration', () => {
  for (const interval of [5, 15, 30, 60]) {
    const stats = summarise(channel([Array(1440 / interval).fill(interval / 60 * 6)], interval));
    assert.equal(stats.demand.mean, 6);
    assert.equal(stats.demand.median, 6);
    assert.equal(stats.dailyEnergy.mean, 144);
  }
});

test('statistics follow the selected date range without modifying input', () => {
  const input = channel([[12, 12], [24, 24], [120, 120]]);
  const before = JSON.stringify(input);
  const filtered = { ...input, data: { 20260102: input.data[20260102] } };
  assert.equal(summarise(filtered).dailyEnergy.mean, 48);
  assert.equal(summarise(filtered).demand.median, 2);
  assert.equal(JSON.stringify(input), before);
});

test('analysis loads statistics before the controller and its inline scripts compile', () => {
  const html = readFileSync(new URL('../dist/analysis.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="analysis-statistics.js"') < html.indexOf('const App ='));
  for (const [, attributes, code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!attributes.includes('src=')) new vm.Script(code);
  }
  for (const label of ['Mean Import Demand', 'Median Import Demand', 'Mean Daily Import', 'Median Daily Import']) {
    assert.ok(html.includes(label));
  }
  assert.ok(html.includes('MeterStatistics.summarise(e1)'));
});

test('actual summary renderer displays all four statistics and handles empty dates', () => {
  const html = readFileSync(new URL('../dist/analysis.html', import.meta.url), 'utf8');
  const body = html.split('  renderAll() {')[1].split('    // ─ Charts')[0];
  const cards = { innerHTML: '' };
  const analytics = {
    dailyTotals: ch => Object.values(ch.data).map(day => ({
      total: day.values.reduce((sum, value) => sum + value, 0),
    })),
    intervalLabels: () => [],
    peakDemand: () => ({ peak: 10, peakDate: null }),
    qualityStats: () => ({ pctActual: 100 }),
    powerFactor: () => null,
  };
  const context = vm.createContext({
    Analytics: analytics,
    document: { getElementById: () => cards },
    selected: channel([[12, 36], [24, 120]]),
  });
  vm.runInContext(source, context);
  const render = () => vm.runInContext(
    '(function () {' + body + '}).call({getFiltered: () => ({E1: selected})})', context);
  render();
  assert.match(cards.innerHTML, /4\.0<span class="card-unit"> kW/);
  assert.match(cards.innerHTML, /2\.5<span class="card-unit"> kW/);
  assert.equal((cards.innerHTML.match(/96\.0<span class="card-unit"> kWh\/day/g) || []).length, 2);
  context.selected = channel([]);
  render();
  assert.equal((cards.innerHTML.match(/card-value">—/g) || []).length, 4);
  assert.ok(!cards.innerHTML.includes('NaN'));
});
