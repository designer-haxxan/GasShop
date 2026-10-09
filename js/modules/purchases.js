// Purchases from suppliers: filled cylinders, empties sent for refill at the plant, bulk gas and accessories.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtQty, fmtDate, fmtDateTime, today, lc, num, round2, debounce, round3 } from '../core/utils.js';
import { getSettings, cylinderType } from '../core/settings.js';
import { pageHeader, emptyState, errorState } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';
import * as Gas from '../services/gas.js';
import { openPartyForm } from './parties.js';
import { pager } from '../core/views.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);

const KIND = {
  cylFull: { icon: 'fuel-pump', label: 'Filled cylinders', unit: 'cyl', rateLabel: 'Cost per cylinder' },
  refillPlant: { icon: 'arrow-repeat', label: 'Empties refilled at plant', unit: 'cyl', rateLabel: 'Refill cost per cylinder' },
  gasBulk: { icon: 'droplet-half', label: 'Bulk gas', unit: 'kg', rateLabel: 'Rate per kg' },
  item: { icon: 'bag', label: 'Accessory', unit: 'pc', rateLabel: 'Cost per piece' },
};

// ---------- List ----------
async function renderList(el, setTitle) {
  setTitle('Purchases');
  const rows = (await read(['purchases'], (t) => t.getAll('purchases'))).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const live = rows.filter((p) => p.status !== 'void');
  const total = round2(live.reduce((a, p) => a + p.total, 0));
  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Purchases', Auth.can('purchase.manage') ? '<a class="btn btn-grad btn-sm" href="#/purchases/new"><i class="bi bi-plus-lg me-1"></i>New purchase</a>' : '')}
    <div class="summary-strip card-lift mb-3">
      <div><div class="small text-body-secondary">Total bought</div><div class="fs-4 fw-bold">${esc(cur())} ${f2(total)}</div></div>
      <div class="text-end small text-body-secondary">${live.length} purchases</div>
    </div>
    <div class="search-box mb-2"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="pu-q" placeholder="Search supplier or number" autocomplete="off"></div>
    <div class="card-lift p-0 overflow-hidden" id="pu-list"></div>
  </div>`;
  const $el = window.jQuery(el);
  const draw = (q) => {
    const qq = lc(q);
    const list = rows.filter((p) => !qq || lc(p.supplierName).includes(qq) || lc(p.number).includes(qq));
    pager($el.find('#pu-list'), list, (p) => `<a class="list-row ${p.status === 'void' ? 'is-void' : ''}" href="#/purchases/${encodeURIComponent(p.id)}">
        <div class="bill-ico tone-green"><i class="bi bi-truck"></i></div>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(p.supplierName)}</div>
          <div class="small text-body-secondary">${esc(p.number)} · ${fmtDate(p.date)} · ${p.lines.length} line${p.lines.length === 1 ? '' : 's'}</div></div>
        <div class="text-end"><div class="fw-bold">${esc(cur())} ${f2(p.total)}</div>
          ${p.status === 'void' ? '<span class="badge text-bg-secondary">Void</span>' : p.due > 0.004 ? `<span class="badge text-bg-danger">Owed ${f2(p.due)}</span>` : '<span class="badge text-bg-success-subtle text-success-emphasis">Paid</span>'}</div></a>`,
    40, emptyState('No purchases yet', 'truck'));
  };
  draw('');
  $el.find('#pu-q').on('input', debounce((e) => draw(e.target.value), 120));
}

// ---------- Detail ----------
async function renderDetail(el, id, setTitle) {
  const p = await read(['purchases'], (t) => t.get('purchases', id));
  if (!p) { el.innerHTML = errorState(new Error('Purchase not found.')); return; }
  setTitle(p.number);
  const canVoid = p.status !== 'void' && Auth.can('purchase.manage');
  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader(p.number, '', '#/purchases')}
    <section class="card-lift p-3 mb-3 ${p.status === 'void' ? 'is-void' : ''}">
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <div><div class="fs-5 fw-bold">${esc(p.supplierName)}</div>
          <div class="small text-body-secondary">${fmtDateTime(p.createdAt)}</div>
          <a class="small" href="#/suppliers/${encodeURIComponent(p.supplierId)}">Supplier ledger</a></div>
        <div class="text-end"><div class="fs-3 fw-bold">${esc(cur())} ${f2(p.total)}</div>
          <div class="small">Paid ${f2(p.paid)} · ${p.due > 0.004 ? `<span class="text-danger">owed ${f2(p.due)}</span>` : 'settled'}</div></div>
      </div>
      ${p.status === 'void' ? '<div class="alert alert-secondary small mt-3 mb-0">This purchase was voided and its stock removed.</div>' : ''}
    </section>
    <div class="card-lift p-0 overflow-hidden mb-3"><div class="table-responsive"><table class="table align-middle mb-0">
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${p.lines.map((l) => `<tr><td>${esc(l.kind === 'cylFull' ? `${l.name} (filled)` : l.kind === 'refillPlant' ? `${l.name} (plant refill)` : l.name)}</td>
        <td class="num">${l.kind === 'gasBulk' ? `${fmtQty(l.kg)} kg` : `${l.qty}`}</td><td class="num">${f2(l.rate)}</td><td class="num fw-semibold">${f2(l.amount)}</td></tr>`).join('')}</tbody>
    </table></div></div>
    ${canVoid ? `<button class="btn btn-outline-danger" id="p-void"><i class="bi bi-x-octagon me-1"></i>Void purchase</button>
      <div class="form-text">Voiding removes the bought stock again. It fails if that stock has already been sold.</div>` : ''}
  </div>`;
  window.jQuery(el).find('#p-void').on('click', async () => {
    const ok = await UI.confirmDialog(`Void ${p.number}? The stock it added will be removed.`, { okLabel: 'Void purchase', okClass: 'btn-danger' });
    if (!ok) return;
    try { await Gas.voidPurchase(id); UI.toast('Purchase voided', 'warning'); renderDetail(el, id, setTitle); } catch (e) { UI.toastError(e); }
  });
}

// ---------- New purchase ----------
let draft = null;

function lineTitle(l) {
  return l.kind === 'item' ? l.name : `${l.name}${l.kind === 'refillPlant' ? ' (plant refill)' : ''}`;
}

async function pickSupplier() {
  const r = await UI.pick({
    title: 'Choose supplier', placeholder: 'Search supplier',
    search: async (q) => {
      const list = await read(['suppliers'], (t) => t.getAll('suppliers'));
      const qq = lc(q);
      return list.filter((s) => !qq || lc(s.name).includes(qq)).sort((a, b) => lc(a.name).localeCompare(lc(b.name)))
        .slice(0, 60).map((s) => ({ id: s.id, title: s.name, subtitle: s.phone || '', value: s }));
    },
    addNew: { label: 'Add new supplier', create: async () => { const s = await openPartyForm('supplier'); return s ? { value: s } : undefined; } },
  });
  if (r) draft.supplier = { id: r.value.id, name: r.value.name };
}

async function lineForm(kind) {
  const items = kind === 'item' ? await read(['items'], (t) => t.getAll('items')) : [];
  const s = getSettings();
  const cylOpts = s.cylinderTypes.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const itemOpts = items.sort((a, b) => lc(a.name).localeCompare(lc(b.name))).map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  const K = KIND[kind];
  return UI.formModal({
    title: K.label, submitLabel: 'Add line',
    body: `
      ${kind === 'item' ? `<label class="form-label">Accessory</label><select class="form-select mb-3" name="itemId">${itemOpts}</select>`
        : kind === 'gasBulk' ? '' : `<label class="form-label">Cylinder type</label><select class="form-select mb-3" name="typeId">${cylOpts}</select>`}
      <div class="row g-2">
        <div class="col-6"><label class="form-label">${kind === 'gasBulk' ? 'Kilograms' : kind === 'item' ? 'Quantity' : 'Cylinders'}</label>
          <input class="form-control form-control-lg" name="qty" type="number" min="0" step="${kind === 'gasBulk' || kind === 'item' ? '0.001' : '1'}" inputmode="decimal" required></div>
        <div class="col-6"><label class="form-label">${K.rateLabel} (${esc(cur())})</label>
          <input class="form-control form-control-lg" name="rate" type="number" min="0" step="0.01" inputmode="decimal" required></div>
      </div>
      ${kind === 'refillPlant' ? '<div class="form-text mt-2">Empty cylinders leave your shop and come back full. The cost is for the refill only.</div>' : ''}`,
    onSubmit: (v) => {
      const qty = num(v.qty);
      if (qty <= 0) throw new Error('Enter a quantity.');
      const line = { kind, rate: num(v.rate), qty, kg: qty };
      if (kind === 'item') {
        const it = items.find((i) => i.id === v.itemId);
        if (!it) throw new Error('Choose an accessory.');
        return { ...line, itemId: it.id, name: it.name };
      }
      if (kind === 'gasBulk') return { ...line, name: 'Bulk gas' };
      const t = cylinderType(v.typeId);
      return { ...line, typeId: t.id, name: t.name, qty: Math.round(qty) };
    },
  });
}

function renderNew(el, setTitle) {
  setTitle('New purchase');
  draft = draft || { supplier: null, lines: [], paid: null };
  const total = round2(draft.lines.reduce((a, l) => a + round2(l.kind === 'gasBulk' ? l.kg * l.rate : l.qty * l.rate), 0));
  const paid = draft.paid === null ? total : Math.min(Math.max(num(draft.paid), 0), total);
  const due = round2(total - paid);

  el.innerHTML = `
  <div class="anim-rise purchase-page">
    ${pageHeader('New purchase', '', '#/purchases')}
    <button type="button" class="card-lift supplier-pick w-100 mb-3" id="np-supplier">
      <span class="avatar-sm tint-green"><i class="bi bi-truck"></i></span>
      <span class="flex-grow-1 min-w-0 text-start"><span class="d-block small text-body-secondary">Supplier</span>
        <span class="d-block fw-semibold text-truncate">${draft.supplier ? esc(draft.supplier.name) : 'Choose supplier…'}</span></span>
      <span class="btn btn-sm btn-outline-secondary">${draft.supplier ? 'Change' : 'Choose'}</span>
    </button>

    <div class="section-title"><i class="bi bi-plus-circle"></i> Add to purchase</div>
    <div class="kind-grid mb-3">
      ${Object.entries(KIND).map(([k, v]) => `<button type="button" class="tile card-lift" data-kind="${k}">
        <span class="tile-ico"><i class="bi bi-${v.icon}"></i></span><span class="tile-name">${esc(v.label)}</span></button>`).join('')}
    </div>

    <div class="card-lift p-0 overflow-hidden mb-3">
      ${draft.lines.length ? draft.lines.map((l, i) => `<div class="cart-line">
          <div class="cart-ico tone-${l.kind === 'gasBulk' ? 'blue' : l.kind === 'item' ? 'violet' : 'flame'}"><i class="bi bi-${KIND[l.kind].icon}"></i></div>
          <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(lineTitle(l))}</div>
            <div class="small text-body-secondary">${fmtQty(l.qty)} ${KIND[l.kind].unit} × ${f2(l.rate)}</div></div>
          <div class="text-end"><div class="fw-bold">${f2(round2(l.kind === 'gasBulk' ? l.kg * l.rate : l.qty * l.rate))}</div>
            <button type="button" class="btn btn-link btn-sm text-danger p-0" data-rm="${i}" aria-label="Remove line"><i class="bi bi-x-lg"></i></button></div>
        </div>`).join('') : '<div class="cart-empty"><div class="cart-empty-ico"><i class="bi bi-cart-plus"></i></div><div class="small text-body-secondary">Add cylinders, plant refills, bulk gas or accessories.</div></div>'}
    </div>

    <div class="card-lift p-3">
      <div class="sum-row"><span class="fw-semibold">Total</span><span class="fs-5 fw-bold">${esc(cur())} ${f2(total)}</span></div>
      <div class="sum-row mt-2"><span>Paid now</span><input type="number" min="0" step="0.01" inputmode="decimal" class="form-control form-control-sm sum-input" id="np-paid" value="${paid}"></div>
      <div class="d-flex justify-content-between align-items-center mt-2"><span class="small text-body-secondary">Owed to supplier</span>
        <span class="badge rounded-pill ${due > 0.004 ? 'text-bg-warning' : 'text-bg-success'}">${esc(cur())} ${f2(due)}</span></div>
      <button class="btn btn-grad btn-lg w-100 mt-3" id="np-save" ${draft.lines.length && draft.supplier ? '' : 'disabled'}><i class="bi bi-check2-circle me-1"></i>Save purchase</button>
      ${!draft.supplier ? '<div class="form-text text-center">Choose a supplier to save.</div>' : ''}
    </div>
  </div>`;

  const $el = window.jQuery(el);
  $el.find('#np-supplier').on('click', async () => { await pickSupplier(); renderNew(el, setTitle); });
  $el.find('[data-kind]').on('click', async (e) => {
    const kind = e.currentTarget.dataset.kind;
    if (kind !== 'gasBulk' && !getSettings().cylinderTypes.length) return UI.toast('Add cylinder types in Settings first.', 'warning');
    const line = await lineForm(kind);
    if (line) { draft.lines.push(line); renderNew(el, setTitle); }
  });
  $el.find('[data-rm]').on('click', (e) => { draft.lines.splice(+e.currentTarget.dataset.rm, 1); renderNew(el, setTitle); });
  $el.find('#np-paid').on('change', (e) => { draft.paid = num(e.currentTarget.value); renderNew(el, setTitle); });
  $el.find('#np-save').on('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const row = await Gas.savePurchase({
        supplierId: draft.supplier.id,
        lines: draft.lines.map((l) => ({ ...l, qty: round3(l.qty) })),
        paid: paid, date: today(),
      });
      draft = null;
      UI.toast(`Saved ${row.number}`);
      location.hash = `#/purchases/${encodeURIComponent(row.id)}`;
    } catch (err) { UI.toastError(err); e.currentTarget.disabled = false; }
  });
}

export async function render(el, { params, setTitle }) {
  if (params[0] === 'new') return renderNew(el, setTitle);
  if (params[0]) return renderDetail(el, params[0], setTitle);
  return renderList(el, setTitle);
}
