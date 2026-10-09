// Gas shop business rules: stock (cylinders, bulk gas, accessories), sales, purchases, payments and balances.
// Every change to stock runs in one IndexedDB transaction together with its movement rows, so the counts
// and the bills/purchases can never disagree.
import { read, write, getAllByIndex } from '../db/idb.js';
import { uuid, round2, round3, num, today, nowISO, clean, lc, AppError, fmtQty } from '../core/utils.js';
import { getSettings, cylinderType } from '../core/settings.js';
import * as Auth from './auth.js';

export const PARTY_STORE = { customer: 'customers', supplier: 'suppliers' };
const cylName = (id) => cylinderType(id)?.name || id;
const inRange = (from, to) => (r) => r.date >= from && r.date <= to;
const sumBy = (rows, f) => round2(rows.reduce((s, r) => s + num(r[f]), 0));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const audit = (t, action, detail) => t.put('auditLog', { id: uuid(), at: nowISO(), user: Auth.user()?.username || '', action, detail });

// ---------- Stock deltas ----------
// A delta describes a change to stock: { gasKg, cyl: { [typeId]: {full, empty} }, items: { [itemId]: qty } }.
const emptyDelta = () => ({ gasKg: 0, cyl: {}, items: {} });
const cylSlot = (d, id) => (d.cyl[id] ||= { full: 0, empty: 0 });

function saleDelta(lines) {
  const d = emptyDelta();
  for (const l of lines) {
    if (l.kind === 'refill') d.gasKg -= l.kg;
    else if (l.kind === 'cyl') { cylSlot(d, l.typeId).full -= l.out; cylSlot(d, l.typeId).empty += l.in; }
    else if (l.kind === 'item') d.items[l.itemId] = (d.items[l.itemId] || 0) - l.qty;
  }
  return d;
}

function purchaseDelta(lines) {
  const d = emptyDelta();
  for (const l of lines) {
    if (l.kind === 'cylFull') cylSlot(d, l.typeId).full += l.qty;
    else if (l.kind === 'refillPlant') { cylSlot(d, l.typeId).empty -= l.qty; cylSlot(d, l.typeId).full += l.qty; }
    else if (l.kind === 'gasBulk') d.gasKg += l.kg;
    else if (l.kind === 'item') d.items[l.itemId] = (d.items[l.itemId] || 0) + l.qty;
  }
  return d;
}

function negate(d) {
  const out = { gasKg: -d.gasKg, cyl: {}, items: {} };
  for (const [k, c] of Object.entries(d.cyl)) out.cyl[k] = { full: -c.full, empty: -c.empty };
  for (const [k, q] of Object.entries(d.items)) out.items[k] = -q;
  return out;
}

// Applies a delta inside an open transaction. Throws (and so aborts the whole save) if any count would go negative.
async function applyDelta(t, d, m) {
  const at = nowISO();
  const log = (row) => t.put('movements', { id: uuid(), at, date: m.date, refId: m.refId, kind: m.kind, note: m.note || '', ...row });

  if (d.gasKg) {
    const cur = num((await t.get('meta', 'gasKg'))?.value);
    const next = round3(cur + d.gasKg);
    if (next < 0) throw new AppError(`Not enough gas in the tank: ${fmtQty(cur)} kg left, ${fmtQty(-d.gasKg)} kg needed.`);
    await t.put('meta', { key: 'gasKg', value: next });
    await log({ target: 'gas', targetId: 'gas', qty: round3(d.gasKg) });
  }
  for (const [typeId, c] of Object.entries(d.cyl)) {
    if (!c.full && !c.empty) continue;
    const row = (await t.get('cylStock', typeId)) || { id: typeId, full: 0, empty: 0 };
    const full = row.full + c.full;
    const empty = row.empty + c.empty;
    if (full < 0) throw new AppError(`Not enough full ${cylName(typeId)} cylinders: ${row.full} in stock.`);
    if (empty < 0) throw new AppError(`Not enough empty ${cylName(typeId)} cylinders: ${row.empty} in stock.`);
    await t.put('cylStock', { id: typeId, full, empty });
    await log({ target: 'cyl', targetId: typeId, full: c.full, empty: c.empty });
  }
  for (const [itemId, q] of Object.entries(d.items)) {
    if (!q) continue;
    const it = await t.get('items', itemId);
    if (!it) throw new AppError('An accessory on this bill no longer exists.');
    const next = round3(num(it.stock) + q);
    if (next < 0) throw new AppError(`Not enough ${it.name} in stock: ${fmtQty(it.stock)} left.`);
    await t.put('items', { ...it, stock: next, updatedAt: at });
    await log({ target: 'item', targetId: itemId, qty: round3(q) });
  }
}

async function nextNumber(t, name, prefix) {
  const key = `counter:${name}`;
  const n = num((await t.get('meta', key))?.value) + 1;
  await t.put('meta', { key, value: n });
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

// ---------- Line normalisation (amounts are recalculated here, never trusted from the form) ----------
function normalizeSaleLines(lines) {
  const out = [];
  for (const l of lines || []) {
    if (l.kind === 'refill') {
      const t = cylinderType(l.typeId);
      const count = Math.round(num(l.qty));
      if (!t) throw new AppError('Unknown cylinder type.');
      if (count <= 0) throw new AppError(`Enter how many ${t.name} cylinders to refill.`);
      const kg = round3(count * t.kg);
      const rate = round2(num(l.rate));
      out.push({ kind: 'refill', typeId: t.id, name: t.name, qty: count, kg, rate, amount: round2(kg * rate) });
    } else if (l.kind === 'cyl') {
      const t = cylinderType(l.typeId);
      const o = Math.round(num(l.out));
      const i = Math.round(num(l.in));
      if (!t) throw new AppError('Unknown cylinder type.');
      if (o < 0 || i < 0 || o + i === 0) throw new AppError(`Enter cylinders for ${t.name}.`);
      const rate = round2(num(l.rate));
      out.push({ kind: 'cyl', typeId: t.id, name: t.name, qty: o, out: o, in: i, rate, amount: round2(o * rate) });
    } else if (l.kind === 'item') {
      const qty = round3(num(l.qty));
      if (!l.itemId) throw new AppError('Unknown accessory.');
      if (qty <= 0) throw new AppError(`Enter a quantity for ${l.name || 'the accessory'}.`);
      const rate = round2(num(l.rate));
      out.push({ kind: 'item', itemId: l.itemId, name: clean(l.name, 120), qty, rate, amount: round2(qty * rate) });
    } else throw new AppError('Unknown line type.');
  }
  if (!out.length) throw new AppError('Add at least one item to the bill.');
  return out;
}

function normalizePurchaseLines(lines) {
  const out = [];
  for (const l of lines || []) {
    if (l.kind === 'cylFull' || l.kind === 'refillPlant') {
      const t = cylinderType(l.typeId);
      const qty = Math.round(num(l.qty));
      if (!t) throw new AppError('Unknown cylinder type.');
      if (qty <= 0) throw new AppError(`Enter how many ${t.name} cylinders.`);
      const rate = round2(num(l.rate));
      out.push({ kind: l.kind, typeId: t.id, name: t.name, qty, rate, amount: round2(qty * rate) });
    } else if (l.kind === 'gasBulk') {
      const kg = round3(num(l.kg));
      if (kg <= 0) throw new AppError('Enter the kilograms of bulk gas.');
      const rate = round2(num(l.rate));
      out.push({ kind: 'gasBulk', name: 'Bulk gas', kg, qty: kg, rate, amount: round2(kg * rate) });
    } else if (l.kind === 'item') {
      const qty = round3(num(l.qty));
      if (!l.itemId) throw new AppError('Unknown accessory.');
      if (qty <= 0) throw new AppError(`Enter a quantity for ${l.name || 'the accessory'}.`);
      const rate = round2(num(l.rate));
      out.push({ kind: 'item', itemId: l.itemId, name: clean(l.name, 120), qty, rate, amount: round2(qty * rate) });
    } else throw new AppError('Unknown line type.');
  }
  if (!out.length) throw new AppError('Add at least one line to the purchase.');
  return out;
}

// ---------- Counter sales ----------
export async function saveSale({ customerId = null, lines, discount = 0, paid = 0, method = 'cash', date = today() }) {
  Auth.require('sale.create');
  const norm = normalizeSaleLines(lines);
  const subtotal = sumBy(norm, 'amount');
  const disc = clamp(round2(num(discount)), 0, subtotal);
  const total = round2(subtotal - disc);
  const pd = clamp(round2(num(paid)), 0, total);
  const due = round2(total - pd);
  if (due > 0 && !customerId) throw new AppError('Choose a customer for an unpaid balance, or collect the full amount.');
  if (!['cash', 'bank'].includes(method)) throw new AppError('Choose a payment method.');
  const prefix = getSettings().prefixes.bill;

  return write(['meta', 'cylStock', 'items', 'movements', 'bills', 'customers'], async (t) => {
    let customerName = 'Walk-in';
    if (customerId) {
      const c = await t.get('customers', customerId);
      if (!c) throw new AppError('Customer not found.');
      customerName = c.name;
    }
    const id = uuid();
    const number = await nextNumber(t, 'bill', prefix);
    await applyDelta(t, saleDelta(norm), { refId: id, kind: 'sale', date, note: number });
    const bill = {
      id, number, date, createdAt: nowISO(), customerId: customerId || null, customerName,
      lines: norm, subtotal, discount: disc, total, paid: pd, due, method, status: 'final',
    };
    await t.put('bills', bill);
    return bill;
  });
}

export async function voidSale(billId, reason = '') {
  Auth.require('sale.void');
  return write(['meta', 'cylStock', 'items', 'movements', 'bills', 'auditLog'], async (t) => {
    const b = await t.get('bills', billId);
    if (!b) throw new AppError('Bill not found.');
    if (b.status === 'void') throw new AppError('This bill is already void.');
    await applyDelta(t, negate(saleDelta(b.lines)), { refId: b.id, kind: 'void', date: today(), note: b.number });
    await t.put('bills', { ...b, status: 'void', voidedAt: nowISO(), voidReason: clean(reason, 200) });
    await audit(t, 'void-sale', `Voided ${b.number} (${fmtQty(b.total)})`);
  });
}

// ---------- Purchases ----------
export async function savePurchase({ supplierId, lines, paid = 0, date = today() }) {
  Auth.require('purchase.manage');
  if (!supplierId) throw new AppError('Choose a supplier.');
  const norm = normalizePurchaseLines(lines);
  const total = sumBy(norm, 'amount');
  const pd = clamp(round2(num(paid)), 0, total);
  const due = round2(total - pd);
  const prefix = getSettings().prefixes.purchase;

  return write(['meta', 'cylStock', 'items', 'movements', 'purchases', 'suppliers'], async (t) => {
    const s = await t.get('suppliers', supplierId);
    if (!s) throw new AppError('Supplier not found.');
    const id = uuid();
    const number = await nextNumber(t, 'purchase', prefix);
    await applyDelta(t, purchaseDelta(norm), { refId: id, kind: 'purchase', date, note: number });
    for (const l of norm) {
      if (l.kind !== 'item') continue;
      const it = await t.get('items', l.itemId);
      await t.put('items', { ...it, costPrice: l.rate });
    }
    const row = {
      id, number, date, createdAt: nowISO(), supplierId, supplierName: s.name,
      lines: norm, total, paid: pd, due, status: 'final',
    };
    await t.put('purchases', row);
    return row;
  });
}

export async function voidPurchase(purchaseId) {
  Auth.require('purchase.manage');
  return write(['meta', 'cylStock', 'items', 'movements', 'purchases', 'auditLog'], async (t) => {
    const p = await t.get('purchases', purchaseId);
    if (!p) throw new AppError('Purchase not found.');
    if (p.status === 'void') throw new AppError('This purchase is already void.');
    await applyDelta(t, negate(purchaseDelta(p.lines)), { refId: p.id, kind: 'void', date: today(), note: p.number });
    await t.put('purchases', { ...p, status: 'void', voidedAt: nowISO() });
    await audit(t, 'void-purchase', `Voided ${p.number}`);
  });
}

// ---------- Payments (customer receipts, supplier payments) ----------
export async function savePayment({ partyType, partyId, amount, method = 'cash', note = '', date = today() }) {
  const store = PARTY_STORE[partyType];
  if (!store) throw new AppError('Unknown party.');
  Auth.require(partyType === 'customer' ? 'payment.collect' : 'purchase.manage');
  const amt = round2(num(amount));
  if (amt <= 0) throw new AppError('Enter an amount greater than zero.');
  return write(['payments', store], async (t) => {
    const p = await t.get(store, partyId);
    if (!p) throw new AppError('Party not found.');
    const row = { id: uuid(), date, createdAt: nowISO(), partyType, partyId, partyName: p.name, amount: amt, method, note: clean(note, 200) };
    await t.put('payments', row);
    return row;
  });
}

// ---------- Expenses ----------
export async function saveExpense({ id, date = today(), category, amount, note = '' }) {
  Auth.require('expense.manage');
  const amt = round2(num(amount));
  if (amt <= 0) throw new AppError('Enter an amount greater than zero.');
  if (!category) throw new AppError('Choose a category.');
  return write(['expenses'], async (t) => {
    const old = id ? await t.get('expenses', id) : null;
    const row = { id: id || uuid(), date, category: clean(category, 60), amount: amt, note: clean(note, 200), createdAt: old?.createdAt || nowISO() };
    await t.put('expenses', row);
    return row;
  });
}

export async function deleteExpense(id) {
  Auth.require('expense.manage');
  return write(['expenses'], (t) => t.delete('expenses', id));
}

// ---------- Customers, suppliers and accessories ----------
export async function saveParty(type, { id, name, phone = '', address = '', openingBalance = 0 }) {
  const store = PARTY_STORE[type];
  if (!store) throw new AppError('Unknown party.');
  Auth.require(type === 'customer' ? 'customer.edit' : 'supplier.manage');
  name = clean(name, 120);
  if (!name) throw new AppError('Enter a name.');
  return write([store], async (t) => {
    const old = id ? await t.get(store, id) : null;
    if (id && !old) throw new AppError('Record not found.');
    const row = {
      id: id || uuid(), name, nameLc: lc(name), phone: clean(phone, 30), address: clean(address, 200),
      openingBalance: round2(num(openingBalance)), createdAt: old?.createdAt || nowISO(), updatedAt: nowISO(),
    };
    await t.put(store, row);
    return row;
  });
}

export async function saveItem({ id, name, sku = '', barcode = '', category = '', costPrice = 0, salePrice = 0, minStock = 0, openingStock = 0 }) {
  Auth.require('item.manage');
  name = clean(name, 120);
  if (!name) throw new AppError('Enter a name.');
  return write(['items', 'movements'], async (t) => {
    const old = id ? await t.get('items', id) : null;
    if (id && !old) throw new AppError('Accessory not found.');
    const row = {
      id: id || uuid(), name, nameLc: lc(name), sku: clean(sku, 40), barcode: clean(barcode, 40), category: clean(category, 60),
      costPrice: round2(num(costPrice)), salePrice: round2(num(salePrice)), minStock: round3(num(minStock)),
      stock: old ? old.stock : 0, createdAt: old?.createdAt || nowISO(), updatedAt: nowISO(),
    };
    await t.put('items', row);
    const os = round3(num(openingStock));
    if (!old && os > 0) await applyDelta(t, { ...emptyDelta(), items: { [row.id]: os } }, { refId: row.id, kind: 'opening', date: today(), note: row.name });
    return row;
  });
}

// ---------- Stock counts (manager) ----------
export async function adjustCylinders(typeId, { full, empty }, note = 'Stock count') {
  Auth.require('stock.adjust');
  const f = Math.max(0, Math.round(num(full)));
  const e = Math.max(0, Math.round(num(empty)));
  return write(['cylStock', 'movements', 'meta'], async (t) => {
    const row = (await t.get('cylStock', typeId)) || { full: 0, empty: 0 };
    const d = emptyDelta();
    d.cyl[typeId] = { full: f - row.full, empty: e - row.empty };
    await applyDelta(t, d, { refId: uuid(), kind: 'adjust', date: today(), note: clean(note, 120) });
  });
}

export async function adjustGas(kgInTank, note = 'Tank reading') {
  Auth.require('stock.adjust');
  const target = round3(num(kgInTank));
  if (target < 0) throw new AppError('The tank cannot hold less than zero kg.');
  return write(['meta', 'movements'], async (t) => {
    const cur = num((await t.get('meta', 'gasKg'))?.value);
    const d = { ...emptyDelta(), gasKg: round3(target - cur) };
    await applyDelta(t, d, { refId: uuid(), kind: 'adjust', date: today(), note: clean(note, 120) });
  });
}

export async function adjustItem(itemId, newStock, note = 'Stock count') {
  Auth.require('stock.adjust');
  return write(['items', 'movements'], async (t) => {
    const it = await t.get('items', itemId);
    if (!it) throw new AppError('Accessory not found.');
    const d = { ...emptyDelta(), items: { [itemId]: round3(num(newStock) - num(it.stock)) } };
    await applyDelta(t, d, { refId: uuid(), kind: 'adjust', date: today(), note: clean(note, 120) });
  });
}

// ---------- Balances and ledgers ----------
// Map of party id → amount owed (positive) or credit held (negative). Customers owe us; we owe suppliers.
export function partyDues() {
  return read(['customers', 'suppliers', 'bills', 'purchases', 'payments'], async (t) => {
    const [customers, suppliers, bills, purchases, payments] = await Promise.all([
      t.getAll('customers'), t.getAll('suppliers'), t.getAll('bills'), t.getAll('purchases'), t.getAll('payments'),
    ]);
    const due = new Map();
    const add = (id, v) => due.set(id, round2((due.get(id) || 0) + v));
    for (const p of [...customers, ...suppliers]) add(p.id, num(p.openingBalance));
    for (const b of bills) if (b.status !== 'void' && b.customerId) add(b.customerId, num(b.due));
    for (const p of purchases) if (p.status !== 'void') add(p.supplierId, num(p.due));
    for (const p of payments) add(p.partyId, -num(p.amount));
    return due;
  });
}

// Statement for one customer or supplier: each row either adds to the balance (inc) or reduces it (dec).
export function partyLedger(type, id) {
  const store = PARTY_STORE[type];
  return read([store, 'bills', 'purchases', 'payments'], async (t) => {
    const [party, bills, purchases, payments] = await Promise.all([
      t.get(store, id), t.getAll('bills'), t.getAll('purchases'), t.getAll('payments'),
    ]);
    if (!party) throw new AppError('Record not found.');
    const rows = [];
    for (const b of bills) if (b.customerId === id && b.status !== 'void') {
      rows.push({ date: b.date, at: b.createdAt, label: 'Sale', ref: b.number, id: b.id, route: `#/sales/${b.id}`, inc: b.total, dec: b.paid });
    }
    for (const p of purchases) if (p.supplierId === id && p.status !== 'void') {
      rows.push({ date: p.date, at: p.createdAt, label: 'Purchase', ref: p.number, id: p.id, route: `#/purchases/${p.id}`, inc: p.total, dec: p.paid });
    }
    for (const p of payments) if (p.partyId === id) {
      rows.push({ date: p.date, at: p.createdAt, label: type === 'customer' ? 'Received' : 'Paid', ref: p.method, note: p.note, inc: 0, dec: p.amount });
    }
    rows.sort((a, b) => `${a.date} ${a.at || ''}`.localeCompare(`${b.date} ${b.at || ''}`));
    const opening = round2(num(party.openingBalance));
    let bal = opening;
    for (const r of rows) { bal = round2(bal + r.inc - r.dec); r.balance = bal; }
    return { party, opening, rows, closing: bal };
  });
}

// Cash in / cash out for a date range (cash and bank combined).
export function cashSummary(from, to) {
  return read(['bills', 'purchases', 'payments', 'expenses'], async (t) => {
    const [bills, purchases, payments, expenses] = await Promise.all([
      t.getAll('bills'), t.getAll('purchases'), t.getAll('payments'), t.getAll('expenses'),
    ]);
    const r = inRange(from, to);
    const salesPaid = sumBy(bills.filter((b) => b.status !== 'void' && r(b)), 'paid');
    const receipts = sumBy(payments.filter((p) => p.partyType === 'customer' && r(p)), 'amount');
    const purchasesPaid = sumBy(purchases.filter((p) => p.status !== 'void' && r(p)), 'paid');
    const supplierPaid = sumBy(payments.filter((p) => p.partyType === 'supplier' && r(p)), 'amount');
    const expenseTotal = sumBy(expenses.filter(r), 'amount');
    const cashIn = round2(salesPaid + receipts);
    const cashOut = round2(purchasesPaid + supplierPaid + expenseTotal);
    return { salesPaid, receipts, cashIn, purchasesPaid, supplierPaid, expenses: expenseTotal, cashOut, net: round2(cashIn - cashOut) };
  });
}

// Bills for one day, used by the dashboard.
export const billsOn = (date) => getAllByIndex('bills', 'date', date);

export { sumBy, inRange };
