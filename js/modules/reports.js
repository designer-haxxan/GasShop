// Reports: each report builds one table that is shown on screen, exported as CSV and printed.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtQty, fmtDate, today, monthStart, round2, num, toCSV, downloadFile } from '../core/utils.js';
import { getSettings, cylinderType } from '../core/settings.js';
import { printHtml, shopHeader } from '../core/print.js';
import { pageHeader } from '../core/ui.js';
import * as Gas from '../services/gas.js';
import { dateFilter, bindDateFilter, plainNum } from '../core/views.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);

const REPORTS = [
  ['daily', 'Daily sales', 'calendar3', true],
  ['cyl', 'Cylinders', 'arrow-left-right', true],
  ['items', 'Accessories', 'bag', true],
  ['profit', 'Profit', 'graph-up', true],
  ['dues', 'Dues', 'wallet2', false],
  ['stock', 'Stock value', 'boxes', false],
];

const bills = (from, to) => read(['bills'], async (t) => (await t.getAll('bills')).filter((b) => b.status !== 'void' && b.date >= from && b.date <= to));
const purchases = (from, to) => read(['purchases'], async (t) => (await t.getAll('purchases')).filter((p) => p.status !== 'void' && p.date >= from && p.date <= to));

// Each builder returns { title, head, rows, foot?, numeric: Set of column indexes, note? }
const BUILD = {
  async daily(from, to) {
    const list = await bills(from, to);
    const by = new Map();
    for (const b of list) {
      const r = by.get(b.date) || { n: 0, total: 0, paid: 0, due: 0, kg: 0, out: 0, in: 0 };
      r.n += 1; r.total += b.total; r.paid += b.paid; r.due += b.due;
      for (const l of b.lines) {
        if (l.kind === 'refill') r.kg += l.kg;
        if (l.kind === 'cyl') { r.out += l.out; r.in += l.in; }
      }
      by.set(b.date, r);
    }
    const days = [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const tot = days.reduce((a, [, r]) => ({ n: a.n + r.n, total: a.total + r.total, paid: a.paid + r.paid, due: a.due + r.due, kg: a.kg + r.kg, out: a.out + r.out, in: a.in + r.in }), { n: 0, total: 0, paid: 0, due: 0, kg: 0, out: 0, in: 0 });
    return {
      title: `Daily sales ${fmtDate(from)} – ${fmtDate(to)}`,
      head: ['Date', 'Bills', 'Sales', 'Received', 'Credit', 'Gas kg', 'Cyl out', 'Empty in'],
      rows: days.map(([d, r]) => [fmtDate(d), r.n, plainNum(r.total), plainNum(r.paid), plainNum(r.due), fmtQty(r.kg), r.out, r.in]),
      foot: ['Total', tot.n, plainNum(tot.total), plainNum(tot.paid), plainNum(tot.due), fmtQty(tot.kg), tot.out, tot.in],
      numeric: new Set([1, 2, 3, 4, 5, 6, 7]),
    };
  },

  async cyl(from, to) {
    const [list, pur] = await Promise.all([bills(from, to), purchases(from, to)]);
    const by = new Map();
    const slot = (id) => { if (!by.has(id)) by.set(id, { refilled: 0, out: 0, in: 0, bought: 0, plant: 0 }); return by.get(id); };
    for (const b of list) for (const l of b.lines) {
      if (l.kind === 'refill') slot(l.typeId).refilled += l.qty;
      if (l.kind === 'cyl') { slot(l.typeId).out += l.out; slot(l.typeId).in += l.in; }
    }
    for (const p of pur) for (const l of p.lines) {
      if (l.kind === 'cylFull') slot(l.typeId).bought += l.qty;
      if (l.kind === 'refillPlant') slot(l.typeId).plant += l.qty;
    }
    const rows = getSettings().cylinderTypes.map((t) => {
      const r = by.get(t.id) || { refilled: 0, out: 0, in: 0, bought: 0, plant: 0 };
      return [t.name, r.refilled, r.out, r.in, r.bought, r.plant];
    });
    return {
      title: `Cylinders ${fmtDate(from)} – ${fmtDate(to)}`,
      head: ['Type', 'Refilled', 'Swapped out', 'Empty taken', 'Filled bought', 'Sent to plant'],
      rows, numeric: new Set([1, 2, 3, 4, 5]),
      note: 'Refilled = customers’ own cylinders filled from the tank. Swapped out = full shop cylinders given in exchange.',
    };
  },

  async items(from, to) {
    const [list, items] = await Promise.all([bills(from, to), read(['items'], (t) => t.getAll('items'))]);
    const by = new Map();
    for (const b of list) for (const l of b.lines) if (l.kind === 'item') {
      const r = by.get(l.itemId) || { qty: 0, amt: 0 };
      r.qty += l.qty; r.amt += l.amount; by.set(l.itemId, r);
    }
    const rows = [...by.entries()].map(([id, r]) => {
      const it = items.find((i) => i.id === id);
      const cost = round2(r.qty * (it?.costPrice || 0));
      return { name: it?.name || 'Deleted item', qty: r.qty, amt: r.amt, cost, margin: round2(r.amt - cost) };
    }).sort((a, b) => b.amt - a.amt);
    const tot = rows.reduce((a, r) => ({ amt: a.amt + r.amt, cost: a.cost + r.cost, margin: a.margin + r.margin }), { amt: 0, cost: 0, margin: 0 });
    return {
      title: `Accessory sales ${fmtDate(from)} – ${fmtDate(to)}`,
      head: ['Accessory', 'Qty', 'Sales', 'Cost (now)', 'Margin'],
      rows: rows.map((r) => [r.name, fmtQty(r.qty), plainNum(r.amt), plainNum(r.cost), plainNum(r.margin)]),
      foot: ['Total', '', plainNum(tot.amt), plainNum(tot.cost), plainNum(tot.margin)],
      numeric: new Set([1, 2, 3, 4]),
      note: 'Cost uses the current cost price of each accessory.',
    };
  },

  async profit(from, to) {
    const list = await bills(from, to);
    const [items, exp] = await Promise.all([
      read(['items'], (t) => t.getAll('items')),
      read(['expenses'], (t) => t.getAll('expenses')),
    ]);
    const sales = round2(list.reduce((a, b) => a + b.total, 0));
    const gasSales = round2(list.flatMap((b) => b.lines).filter((l) => l.kind === 'refill' || l.kind === 'cyl').reduce((a, l) => a + l.amount, 0));
    const accSales = round2(list.flatMap((b) => b.lines).filter((l) => l.kind === 'item').reduce((a, l) => a + l.amount, 0));
    const accCost = round2(list.flatMap((b) => b.lines).filter((l) => l.kind === 'item')
      .reduce((a, l) => a + l.qty * (items.find((i) => i.id === l.itemId)?.costPrice || 0), 0));
    const expenses = round2(exp.filter((e) => e.date >= from && e.date <= to).reduce((a, e) => a + e.amount, 0));
    const gross = round2(accSales - accCost);
    return {
      title: `Profit ${fmtDate(from)} – ${fmtDate(to)}`,
      head: ['Line', 'Amount'],
      rows: [
        ['Gas refill & swap sales', plainNum(gasSales)],
        ['Accessory sales', plainNum(accSales)],
        ['Total sales', plainNum(sales)],
        ['Accessory cost', `-${plainNum(accCost)}`],
        ['Accessory margin', plainNum(gross)],
        ['Expenses', `-${plainNum(expenses)}`],
        ['Estimated net after expenses', plainNum(round2(gross - expenses))],
      ],
      numeric: new Set([1]),
      note: 'Gas cost is not tracked per kg, so gas margin is not included. Compare with your purchase totals for the full picture.',
    };
  },

  async dues() {
    const [customers, suppliers, dues] = await Promise.all([
      read(['customers'], (t) => t.getAll('customers')), read(['suppliers'], (t) => t.getAll('suppliers')), Gas.partyDues(),
    ]);
    const rows = [];
    for (const c of customers) { const d = round2(dues.get(c.id) || 0); if (Math.abs(d) > 0.004) rows.push(['Customer', c.name, c.phone || '', plainNum(d)]); }
    for (const s of suppliers) { const d = round2(dues.get(s.id) || 0); if (Math.abs(d) > 0.004) rows.push(['Supplier', s.name, s.phone || '', plainNum(d)]); }
    const owed = round2(rows.filter((r) => r[0] === 'Customer').reduce((a, r) => a + num(r[3]), 0));
    const owe = round2(rows.filter((r) => r[0] === 'Supplier').reduce((a, r) => a + num(r[3]), 0));
    return {
      title: 'Dues as of today',
      head: ['Type', 'Name', 'Phone', 'Balance'],
      rows, numeric: new Set([3]),
      foot: ['Customers owe you', '', '', plainNum(owed)],
      foot2: ['You owe suppliers', '', '', plainNum(owe)],
    };
  },

  async stock() {
    const snap = await read(['meta', 'cylStock', 'items'], async (t) => ({
      gasKg: num((await t.get('meta', 'gasKg'))?.value), cyl: await t.getAll('cylStock'), items: await t.getAll('items'),
    }));
    const cylRows = getSettings().cylinderTypes.map((t) => {
      const r = snap.cyl.find((c) => c.id === t.id) || { full: 0, empty: 0 };
      return ['Cylinder', t.name, `${r.full} full · ${r.empty} empty`, ''];
    });
    const itemRows = snap.items.map((i) => ['Accessory', i.name, `${fmtQty(i.stock)} pcs`, plainNum(round2(i.stock * i.costPrice))]);
    const value = round2(snap.items.reduce((a, i) => a + i.stock * i.costPrice, 0));
    return {
      title: 'Stock as of today',
      head: ['Kind', 'Item', 'Quantity', 'Value at cost'],
      rows: [['Gas', 'Bulk gas in tank', `${fmtQty(snap.gasKg)} kg`, ''], ...cylRows, ...itemRows],
      foot: ['Total', '', '', plainNum(value)],
      numeric: new Set([3]),
    };
  },
};

function tableHtml(rep) {
  const head = `<thead><tr>${rep.head.map((h, i) => `<th class="${rep.numeric?.has(i) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>`;
  const body = rep.rows.length ? rep.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${rep.numeric?.has(i) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${rep.head.length}" class="text-center text-body-secondary py-4">Nothing to show for this period</td></tr>`;
  const foot = [rep.foot, rep.foot2].filter(Boolean).map((f) => `<tr class="fw-bold"><td colspan="${Math.max(1, rep.head.length - f.length + 1)}">${esc(f[0])}</td>${f.slice(1).map((c, i) => `<td class="${rep.numeric?.has(i + 1) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 report-table">${head}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

export async function render(el, { params, setTitle }) {
  setTitle('Reports');
  const key = REPORTS.some((r) => r[0] === params[0]) ? params[0] : 'daily';
  const meta = REPORTS.find((r) => r[0] === key);
  const from = monthStart(); const to = today();

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Reports', '<button class="btn btn-light btn-sm" id="rp-print"><i class="bi bi-printer me-1"></i>Print</button><button class="btn btn-light btn-sm" id="rp-csv"><i class="bi bi-filetype-csv me-1"></i>CSV</button>')}
    <div class="report-chips mb-3" role="tablist">
      ${REPORTS.map(([k, label, icon]) => `<a class="report-chip ${k === key ? 'active' : ''}" href="#/reports/${k}"><i class="bi bi-${icon}"></i>${label}</a>`).join('')}
    </div>
    ${meta[3] ? `<div class="card-lift p-3 mb-3">${dateFilter(from, to)}</div>` : ''}
    <div class="card-lift p-0 overflow-hidden anim-rise" id="rp-body"></div>
    <div class="small text-body-secondary mt-2" id="rp-note"></div>
  </div>`;

  const $el = window.jQuery(el);
  let current = null;
  const draw = async (f = from, t = to) => {
    current = await BUILD[key](f, t);
    $el.find('#rp-body').html(`<div class="p-3 fw-semibold border-bottom">${esc(current.title)}</div>${tableHtml(current)}`);
    $el.find('#rp-note').text(current.note || '');
  };
  if (meta[3]) bindDateFilter($el, (f, t) => draw(f, t));
  await draw();

  $el.find('#rp-csv').on('click', () => {
    if (!current) return;
    const rows = [current.head, ...current.rows, ...(current.foot ? [current.foot] : []), ...(current.foot2 ? [current.foot2] : [])];
    downloadFile(`${key}-report.csv`, '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
  });
  $el.find('#rp-print').on('click', () => {
    if (!current) return;
    printHtml(`<div class="receipt wide">${shopHeader()}<div class="pr-meta"><div><b>${esc(current.title)}</b></div></div>${tableHtml(current)}${current.note ? `<div class="pr-foot">${esc(current.note)}</div>` : ''}</div>`, current.title);
  });
}
