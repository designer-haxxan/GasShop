// Counter sale: gas refills (customer's own cylinder, billed per kg), cylinder swaps (full out, empty in)
// and accessories. The cart is kept as a draft on this device, so a page refresh does not lose it.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtQty, num, round2, round3, today, lc, fmtDate } from '../core/utils.js';
import { getSettings, cylinderType, pref } from '../core/settings.js';
import { printHtml, receiptHtml } from '../core/print.js';
import * as UI from '../core/ui.js';
import * as Gas from '../services/gas.js';
import { openPartyForm } from './parties.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);
const DRAFT = 'posDraft';

let state = null;
let stockView = { cyl: [], items: [], gasKg: 0 };
let root = null;

function freshState() {
  return { customer: null, lines: [], discount: 0, paid: null, method: 'cash' };
}

// ---------- Line maths ----------
function lineAmount(l) {
  if (l.kind === 'refill') return round2(l.qty * (cylinderType(l.typeId)?.kg || 0) * l.rate);
  if (l.kind === 'cyl') return round2(l.out * l.rate);
  return round2(l.qty * l.rate);
}
function lineKg(l) { return round3(l.qty * (cylinderType(l.typeId)?.kg || 0)); }

function totals() {
  const sub = round2(state.lines.reduce((a, l) => a + lineAmount(l), 0));
  const disc = Math.min(Math.max(round2(num(state.discount)), 0), sub);
  const total = round2(sub - disc);
  const paid = state.paid === null ? total : Math.min(Math.max(round2(num(state.paid)), 0), total);
  return { sub, disc, total, paid, due: round2(total - paid) };
}

function saveDraft() {
  pref.set(DRAFT, state);
}

// ---------- Rendering ----------
function renderTiles() {
  const s = getSettings();
  const cyl = (id) => stockView.cyl.find((c) => c.id === id) || { full: 0, empty: 0 };
  root.querySelector('#pos-refill').innerHTML = s.cylinderTypes.map((t) => `
    <button type="button" class="tile tile-refill card-lift" data-refill="${esc(t.id)}">
      <span class="tile-ico"><i class="bi bi-fire"></i></span>
      <span class="tile-name">${esc(t.name)}</span>
      <span class="tile-sub">${fmtQty(t.kg)} kg · ${esc(cur())} ${f2(s.gasRate * t.kg)}</span>
    </button>`).join('') || UI.emptyState('Add cylinder types in Settings.', 'fuel-pump');

  root.querySelector('#pos-swap').innerHTML = s.cylinderTypes.map((t) => {
    const c = cyl(t.id);
    return `<button type="button" class="tile tile-swap card-lift ${c.full <= 0 ? 'is-out' : ''}" data-swap="${esc(t.id)}">
      <span class="tile-ico"><i class="bi bi-arrow-left-right"></i></span>
      <span class="tile-name">${esc(t.name)}</span>
      <span class="tile-sub">${esc(cur())} ${f2(t.price)} · <b>${c.full}</b> full</span>
    </button>`;
  }).join('') || UI.emptyState('Add cylinder types in Settings.', 'fuel-pump');

  root.querySelector('#pos-tank').textContent = `${fmtQty(stockView.gasKg)} kg in tank`;
}

function renderCustomer() {
  const c = state.customer;
  root.querySelector('#pos-customer').innerHTML = `
    <span class="avatar-sm tint-${c ? 'indigo' : 'slate'}"><i class="bi bi-${c ? 'person-fill' : 'person'}"></i></span>
    <span class="flex-grow-1 min-w-0 text-start">
      <span class="d-block small text-body-secondary">Customer</span>
      <span class="d-block fw-semibold text-truncate">${esc(c ? c.name : 'Walk-in')}</span>
    </span>
    <span class="btn btn-sm btn-outline-secondary">${c ? 'Change' : 'Choose'}</span>`;
}

function lineRowHtml(l, i) {
  const t = cylinderType(l.typeId);
  let icon = 'bag'; let sub = '';
  let controls = '';
  if (l.kind === 'refill') {
    icon = 'fire';
    sub = `${fmtQty(lineKg(l))} kg of gas`;
    controls = stepper(i, 'qty', l.qty);
  } else if (l.kind === 'cyl') {
    icon = 'arrow-left-right';
    sub = `Give ${l.out} full · take back ${l.in} empty`;
    controls = `<div class="d-flex flex-column gap-1">${stepper(i, 'out', l.out, 'Full out')}${stepper(i, 'in', l.in, 'Empty in')}</div>`;
  } else {
    sub = `${esc(l.name)}`;
    controls = stepper(i, 'qty', l.qty);
  }
  const name = l.kind === 'item' ? l.name : (t?.name || l.name);
  return `<div class="cart-line anim-slide" style="--d:${i * 0.03}s">
    <div class="cart-ico tone-${l.kind === 'item' ? 'blue' : l.kind === 'refill' ? 'flame' : 'violet'}"><i class="bi bi-${icon}"></i></div>
    <div class="flex-grow-1 min-w-0">
      <div class="fw-semibold text-truncate">${esc(name)}</div>
      <div class="small text-body-secondary">${sub}</div>
      <div class="d-flex align-items-center gap-2 flex-wrap mt-1">${controls}
        <label class="rate-field small text-body-secondary">${l.kind === 'refill' ? 'per kg' : 'rate'}
          <input type="number" min="0" step="0.01" inputmode="decimal" class="form-control form-control-sm" data-rate="${i}" value="${l.rate}"></label>
      </div>
    </div>
    <div class="text-end">
      <div class="fw-bold">${esc(cur())} ${f2(lineAmount(l))}</div>
      <button type="button" class="btn btn-link btn-sm text-danger p-0 mt-1" data-remove="${i}" aria-label="Remove"><i class="bi bi-x-lg"></i></button>
    </div>
  </div>`;
}

function stepper(i, field, value, label = '') {
  return `<div class="stepper" role="group" aria-label="${esc(label || field)}">
    ${label ? `<span class="stepper-label">${label}</span>` : ''}
    <button type="button" class="btn btn-light btn-sm" data-step="${i}" data-field="${field}" data-d="-1" aria-label="Less">−</button>
    <span class="stepper-val" aria-live="polite">${value}</span>
    <button type="button" class="btn btn-light btn-sm" data-step="${i}" data-field="${field}" data-d="1" aria-label="More">+</button>
  </div>`;
}

function renderCart() {
  const list = root.querySelector('#pos-lines');
  list.innerHTML = state.lines.length
    ? state.lines.map(lineRowHtml).join('')
    : `<div class="cart-empty"><div class="cart-empty-ico"><i class="bi bi-basket"></i></div>
        <div class="fw-semibold">Cart is empty</div>
        <div class="small text-body-secondary">Tap a refill, a swap or an accessory to add it.</div></div>`;
  root.querySelector('#pos-count').textContent = state.lines.length ? `${state.lines.length} item${state.lines.length === 1 ? '' : 's'}` : '';
  renderSummary();
}

function renderSummary() {
  const t = totals();
  root.querySelector('#pos-sub').textContent = `${cur()} ${f2(t.sub)}`;
  root.querySelector('#pos-total').textContent = `${cur()} ${f2(t.total)}`;
  root.querySelector('#pos-discount').value = state.discount || '';
  const paidEl = root.querySelector('#pos-paid');
  if (document.activeElement !== paidEl) paidEl.value = t.paid;
  root.querySelector('#pos-due').textContent = t.due > 0.004 ? `${cur()} ${f2(t.due)} on credit` : 'Fully paid';
  root.querySelector('#pos-due').className = `badge rounded-pill ${t.due > 0.004 ? 'text-bg-warning' : 'text-bg-success'}`;
  root.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('active', b.dataset.method === state.method));
  root.querySelector('#pos-save').disabled = !state.lines.length;
  root.querySelector('#pos-save-print').disabled = !state.lines.length;
  root.querySelector('#pos-paid-full').classList.toggle('d-none', state.paid === null);
  saveDraft();
}

function refreshAll() { renderCustomer(); renderCart(); }

// ---------- Adding lines ----------
function addLine(line) {
  const same = state.lines.find((l) => l.kind === line.kind && (l.typeId || l.itemId) === (line.typeId || line.itemId));
  if (same) {
    if (line.kind === 'cyl') { same.out += line.out; same.in += line.in; } else same.qty += line.qty;
  } else state.lines.push(line);
  refreshAll();
}

async function addRefill(typeId) {
  const t = cylinderType(typeId);
  if (!t) return;
  if (!(getSettings().gasRate > 0)) UI.toast('Set the gas price per kg in Settings first.', 'warning');
  const v = await UI.formModal({
    title: `Refill ${t.name}`, submitLabel: 'Add refill',
    body: `${qtyField('Cylinders to refill', 1)}<div class="small text-body-secondary mt-2">${fmtQty(t.kg)} kg each · gas in tank: ${fmtQty(stockView.gasKg)} kg</div>`,
    onSubmit: (vals) => {
      const n = Math.round(num(vals.qty));
      if (n <= 0) throw new Error('Enter at least one cylinder.');
      const free = stockView.gasKg - refillKgExcept(-1);
      if (free < n * t.kg) throw new Error(`Not enough gas in the tank: ${fmtQty(free)} kg left after this bill's other refills.`);
      return { n };
    },
  });
  if (!v) return;
  addLine({ kind: 'refill', typeId, name: t.name, qty: v.n, rate: getSettings().gasRate });
  UI.toast(`Added ${v.n} × ${t.name} refill`, 'success', 1800);
}

async function addSwap(typeId) {
  const t = cylinderType(typeId);
  if (!t) return;
  const have = (stockView.cyl.find((c) => c.id === typeId) || { full: 0 }).full;
  const v = await UI.formModal({
    title: `Swap ${t.name}`, submitLabel: 'Add swap',
    body: `${qtyField('Full cylinders given', 1)}
      <div class="form-check mt-3"><input class="form-check-input" type="checkbox" name="takeEmpty" id="pos-take-empty" checked>
      <label class="form-check-label" for="pos-take-empty">Customer hands in an empty one</label></div>
      <div class="small text-body-secondary mt-2">${have} full in shop stock.</div>`,
    onSubmit: (vals) => {
      const n = Math.round(num(vals.qty));
      if (n <= 0) throw new Error('Enter at least one cylinder.');
      if (n > have) throw new Error(`Only ${have} full ${t.name} in stock.`);
      return { n, take: !!vals.takeEmpty };
    },
  });
  if (!v) return;
  addLine({ kind: 'cyl', typeId, name: t.name, out: v.n, in: v.take ? v.n : 0, rate: t.price });
}

function qtyField(label, value) {
  return `<label class="form-label fw-semibold">${esc(label)}</label>
    <input type="number" class="form-control form-control-lg text-center fw-bold" name="qty" min="1" step="1" inputmode="numeric" value="${value}">`;
}

async function addAccessory(itemId) {
  const it = stockView.items.find((i) => i.id === itemId);
  if (!it) return;
  if (it.stock <= 0) UI.toast(`${it.name} is out of stock`, 'warning');
  addLine({ kind: 'item', itemId, name: it.name, qty: 1, rate: it.salePrice });
  root.querySelector('#pos-q').value = '';
  renderAccessoryResults('');
}

function renderAccessoryResults(q) {
  const box = root.querySelector('#pos-acc');
  const qq = lc(q);
  if (!qq) { box.innerHTML = ''; return; }
  const hits = stockView.items.filter((i) => i.nameLc.includes(qq) || (i.barcode && i.barcode === q.trim()) || (i.sku || '').toLowerCase() === qq).slice(0, 8);
  box.innerHTML = hits.length ? hits.map((i) => `<button type="button" class="acc-hit" data-acc="${esc(i.id)}">
      <span class="flex-grow-1 min-w-0 text-start"><span class="d-block fw-medium text-truncate">${esc(i.name)}</span>
      <span class="small text-body-secondary">${esc(cur())} ${f2(i.salePrice)} · ${fmtQty(i.stock)} in stock</span></span>
      <i class="bi bi-plus-circle-fill text-primary"></i></button>`).join('')
    : '<div class="small text-body-secondary p-2">No accessory matches that search.</div>';
}

// ---------- Customer choice ----------
async function searchCustomers(q) {
  const [list, dues] = await Promise.all([read(['customers'], (t) => t.getAll('customers')), Gas.partyDues()]);
  const qq = lc(q);
  return list
    .filter((c) => !qq || c.nameLc.includes(qq) || (c.phone || '').includes(q.trim()))
    .sort((a, b) => a.nameLc.localeCompare(b.nameLc)).slice(0, 60)
    .map((c) => {
      const d = round2(dues.get(c.id) || 0);
      return { id: c.id, title: c.name, subtitle: c.phone || '', right: d > 0.004 ? `Due ${cur()} ${f2(d)}` : '', value: c };
    });
}

async function chooseCustomer() {
  const r = await UI.pick({
    title: 'Choose customer', placeholder: 'Search name or phone', noneLabel: 'Walk-in customer (no name)',
    search: searchCustomers,
    addNew: { label: 'Add new customer', create: async () => { const c = await openPartyForm('customer'); return c ? { value: c } : undefined; } },
  });
  if (r === undefined) return;
  state.customer = r === null ? null : { id: r.value.id, name: r.value.name };
  if (!state.customer && totals().due > 0.004) UI.toast('Walk-in sales must be paid in full.', 'warning');
  renderCustomer(); saveDraft();
}

// ---------- Save ----------
async function save({ print }) {
  const t = totals();
  if (!state.lines.length) return;
  const btn = root.querySelector(print ? '#pos-save-print' : '#pos-save');
  btn.disabled = true;
  try {
    const bill = await Gas.saveSale({
      customerId: state.customer?.id || null, lines: state.lines, discount: t.disc,
      paid: t.paid, method: state.method, date: today(),
    });
    state = freshState();
    saveDraft();
    await loadStock();
    refreshAll(); renderTiles(); renderAccessoryResults('');
    if (print || getSettings().autoPrint) printHtml(receiptHtml(bill), bill.number);
    doneModal(bill);
  } catch (e) {
    UI.toastError(e);
  } finally { renderSummary(); }
}

function doneModal(bill) {
  const due = bill.due > 0.004;
  const m = UI.modal({
    title: 'Sale saved', fullscreenMobile: false, scrollable: false,
    body: `<div class="done-wrap">
      <svg class="done-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
      <div class="fw-bold fs-5 mt-2">${esc(bill.number)}</div>
      <div class="text-body-secondary">${esc(bill.customerName)} · ${fmtDate(bill.date)}</div>
      <div class="display-6 fw-bold mt-2">${esc(cur())} ${f2(bill.total)}</div>
      ${due ? `<span class="badge text-bg-warning mt-2">Balance ${esc(cur())} ${f2(bill.due)} on credit</span>` : '<span class="badge text-bg-success mt-2">Paid in full</span>'}
    </div>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">New sale</button>
      <button class="btn btn-primary btn-print"><i class="bi bi-printer me-1"></i>Print receipt</button>`,
  });
  m.$el.find('.btn-print').on('click', () => printHtml(receiptHtml(bill), bill.number));
}

async function loadStock() {
  const snap = await read(['meta', 'cylStock', 'items'], async (t) => ({
    gasKg: num((await t.get('meta', 'gasKg'))?.value),
    cyl: await t.getAll('cylStock'),
    items: await t.getAll('items'),
  }));
  stockView = {
    gasKg: snap.gasKg,
    cyl: snap.cyl,
    items: snap.items.filter((i) => i.active !== false).map((i) => ({ ...i, nameLc: i.nameLc || lc(i.name) })),
  };
}

// ---------- Page ----------
export async function render(el, { setTitle }) {
  setTitle('Counter Sale');
  state = { ...freshState(), ...(pref.get(DRAFT, null) || {}) };
  state.lines = Array.isArray(state.lines) ? state.lines : [];
  el.innerHTML = `
  <div class="pos anim-rise">
    <div class="pos-grid">
      <section class="pos-tiles">
        <div class="pos-top card-lift">
          <button type="button" class="pos-customer" id="pos-customer" aria-label="Choose customer"></button>
        </div>

        <div class="section-title"><i class="bi bi-fire text-flame"></i> Refill customer's cylinder <span class="ms-auto small fw-normal" id="pos-tank"></span></div>
        <div class="tile-grid" id="pos-refill"></div>

        <div class="section-title mt-3"><i class="bi bi-arrow-left-right"></i> Swap cylinder (full out, empty in)</div>
        <div class="tile-grid" id="pos-swap"></div>

        <div class="section-title mt-3"><i class="bi bi-bag"></i> Accessories</div>
        <div class="search-box"><i class="bi bi-search"></i>
          <input type="search" id="pos-q" class="form-control" placeholder="Search or scan barcode" autocomplete="off" enterkeyhint="search"></div>
        <div id="pos-acc" class="acc-list"></div>
      </section>

      <aside class="pos-cart card-lift">
        <div class="cart-head d-flex align-items-center">
          <div class="fw-bold fs-5">Bill</div>
          <span class="badge rounded-pill text-bg-light border ms-2" id="pos-count"></span>
          <button type="button" class="btn btn-link btn-sm text-danger ms-auto p-0" id="pos-clear">Clear</button>
        </div>
        <div class="cart-lines" id="pos-lines"></div>

        <div class="cart-sum">
          <div class="sum-row"><span>Subtotal</span><span id="pos-sub"></span></div>
          <div class="sum-row"><span>Discount</span>
            <input type="number" min="0" step="0.01" inputmode="decimal" class="form-control form-control-sm sum-input" id="pos-discount" placeholder="0"></div>
          <div class="sum-total"><span>Total</span><span id="pos-total" class="fw-bold"></span></div>
          <div class="sum-row"><span>Received
              <button type="button" class="btn btn-link btn-sm p-0 ms-1 d-none" id="pos-paid-full">Full</button></span>
            <input type="number" min="0" step="0.01" inputmode="decimal" class="form-control form-control-sm sum-input" id="pos-paid"></div>
          <div class="d-flex justify-content-between align-items-center mt-2"><span class="small text-body-secondary">Balance</span><span id="pos-due" class="badge rounded-pill"></span></div>
          <div class="btn-group w-100 mt-3 method-seg" role="group" aria-label="Payment method">
            <button type="button" class="btn btn-outline-secondary" data-method="cash"><i class="bi bi-cash me-1"></i>Cash</button>
            <button type="button" class="btn btn-outline-secondary" data-method="bank"><i class="bi bi-bank me-1"></i>Bank / wallet</button>
          </div>
          <div class="d-grid gap-2 mt-3">
            <button type="button" class="btn btn-grad btn-lg" id="pos-save"><i class="bi bi-check2-circle me-1"></i>Save sale</button>
            <button type="button" class="btn btn-outline-primary" id="pos-save-print"><i class="bi bi-printer me-1"></i>Save &amp; print receipt</button>
          </div>
        </div>
      </aside>
    </div>
  </div>`;
  root = el;

  await loadStock();
  renderTiles();
  refreshAll();
  renderSummary();

  const $r = window.jQuery(el);
  $r.on('click', '[data-refill]', (e) => addRefill(e.currentTarget.dataset.refill));
  $r.on('click', '[data-swap]', (e) => addSwap(e.currentTarget.dataset.swap));
  $r.on('click', '#pos-customer', chooseCustomer);
  $r.on('input', '#pos-q', (e) => renderAccessoryResults(e.currentTarget.value));
  $r.on('keydown', '#pos-q', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = e.currentTarget.value.trim();
    const exact = stockView.items.find((i) => i.barcode && i.barcode === q);
    const first = stockView.items.find((i) => i.nameLc.includes(lc(q)));
    const hit = exact || first;
    if (hit) addAccessory(hit.id);
  });
  $r.on('click', '[data-acc]', (e) => addAccessory(e.currentTarget.dataset.acc));
  $r.on('click', '[data-step]', (e) => {
    const b = e.currentTarget;
    const i = +b.dataset.step; const field = b.dataset.field; const d = +b.dataset.d;
    const l = state.lines[i]; if (!l) return;
    const next = Math.max(0, (l[field] || 0) + d);
    if (l.kind === 'refill' && field === 'qty') {
      if (next === 0) return removeLine(i);
      const inCart = refillKgExcept(i) + next * (cylinderType(l.typeId)?.kg || 0);
      if (inCart > stockView.gasKg) return UI.toast('Not enough gas in the tank.', 'warning');
    }
    if (l.kind === 'cyl' && field === 'out' && next > fullInStock(l.typeId) - outInCartExcept(i, l.typeId)) {
      return UI.toast('No more full cylinders in stock.', 'warning');
    }
    if (l.kind !== 'cyl' && next === 0) return removeLine(i);
    l[field] = next;
    if (l.kind === 'cyl' && l.out === 0 && l.in === 0) return removeLine(i);
    refreshAll();
  });
  $r.on('change', '[data-rate]', (e) => {
    const l = state.lines[+e.currentTarget.dataset.rate]; if (!l) return;
    l.rate = round2(Math.max(0, num(e.currentTarget.value)));
    refreshAll();
  });
  $r.on('click', '[data-remove]', (e) => removeLine(+e.currentTarget.dataset.remove));
  $r.on('click', '#pos-clear', async () => {
    if (!state.lines.length && !state.customer) return;
    if (!await UI.confirmDialog('Clear this bill? The items will be removed.', { okLabel: 'Clear bill', okClass: 'btn-danger' })) return;
    state = freshState(); saveDraft(); refreshAll(); renderSummary();
  });
  $r.on('change', '#pos-discount', (e) => { state.discount = Math.max(0, round2(num(e.currentTarget.value))); renderSummary(); });
  $r.on('change', '#pos-paid', (e) => {
    const v = e.currentTarget.value;
    state.paid = v === '' ? 0 : Math.max(0, round2(num(v)));
    renderSummary();
  });
  $r.on('click', '#pos-paid-full', () => { state.paid = null; renderSummary(); });
  $r.on('click', '[data-method]', (e) => { state.method = e.currentTarget.dataset.method; renderSummary(); });
  $r.on('click', '#pos-save', () => save({ print: false }));
  $r.on('click', '#pos-save-print', () => save({ print: true }));
}

function removeLine(i) {
  state.lines.splice(i, 1);
  refreshAll();
}

// Stock already promised to other cart lines (so two lines cannot together exceed what is in stock).
function refillKgExcept(skip) {
  return state.lines.reduce((a, l, i) => (i !== skip && l.kind === 'refill' ? a + lineKg(l) : a), 0);
}
function outInCartExcept(skip, typeId) {
  return state.lines.reduce((a, l, i) => (i !== skip && l.kind === 'cyl' && l.typeId === typeId ? a + l.out : a), 0);
}
function fullInStock(typeId) {
  return stockView.cyl.find((c) => c.id === typeId)?.full || 0;
}
