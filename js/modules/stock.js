// Stock: cylinders in the shop, bulk gas tank, accessories, and the movement log.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtQty, fmtDate, num, lc, debounce } from '../core/utils.js';
import { getSettings, cylinderType } from '../core/settings.js';
import { cylinderSvg, tankSvg, animateVisuals } from '../core/visuals.js';
import { pageHeader, emptyState } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';
import * as Gas from '../services/gas.js';
import { pager } from '../core/views.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);
const TABS = [['cylinders', 'Cylinders', 'circle-half'], ['gas', 'Gas tank', 'fuel-pump'], ['items', 'Accessories', 'bag'], ['moves', 'Movements', 'list-ul']];

async function loadAll() {
  return read(['meta', 'cylStock', 'items', 'movements'], async (t) => ({
    gasKg: num((await t.get('meta', 'gasKg'))?.value),
    cyl: await t.getAll('cylStock'),
    items: await t.getAll('items'),
    moves: await t.getAll('movements'),
  }));
}

export async function render(el, { params, setTitle }) {
  const tab = TABS.some((t) => t[0] === params[0]) ? params[0] : 'cylinders';
  setTitle('Stock');
  const snap = await loadAll();
  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Stock', '')}
    <div class="stock-tabs mb-3" role="tablist">
      ${TABS.map(([k, label, icon]) => `<a class="stock-tab ${k === tab ? 'active' : ''}" href="#/stock/${k}" role="tab" aria-selected="${k === tab}">
        <i class="bi bi-${icon}"></i><span>${label}</span></a>`).join('')}
    </div>
    <div id="st-body"></div>
  </div>`;
  const body = el.querySelector('#st-body');
  if (tab === 'cylinders') drawCylinders(body, snap, el, setTitle);
  if (tab === 'gas') drawGas(body, snap, el, setTitle);
  if (tab === 'items') drawItems(body, snap, el, setTitle);
  if (tab === 'moves') drawMoves(body, snap);
  animateVisuals(el);
  UI.countUp(el, (n, node) => (node.dataset.fmt === 'kg' ? `${fmtQty(n)} kg` : String(Math.round(n))));
}

// ---------- Cylinders ----------
function drawCylinders(body, snap, page, setTitle) {
  const canAdjust = Auth.can('stock.adjust');
  const types = getSettings().cylinderTypes;
  body.innerHTML = `<div class="row g-3">${types.map((t) => {
    const row = snap.cyl.find((c) => c.id === t.id) || { full: 0, empty: 0 };
    const total = row.full + row.empty;
    const tone = t.kg >= 15 ? 'water' : 'flame';
    return `<div class="col-12 col-md-6 col-xl-4"><div class="card-lift cyl-stock h-100 anim-rise">
      <div class="d-flex gap-3 align-items-center">
        ${cylinderSvg(total ? row.full / total : 0, { tone, label: `${t.name} full ${row.full}` })}
        <div class="flex-grow-1 min-w-0">
          <div class="fw-bold text-truncate">${esc(t.name)}</div>
          <div class="small text-body-secondary">${fmtQty(t.kg)} kg · swap price ${esc(cur())} ${f2(t.price)}</div>
          <div class="d-flex gap-2 mt-2">
            <div class="mini-stat tone-flame"><span data-count="${row.full}" data-fmt="int">0</span><small>Full</small></div>
            <div class="mini-stat tone-steel"><span data-count="${row.empty}" data-fmt="int">0</span><small>Empty</small></div>
          </div>
        </div>
      </div>
      <div class="d-flex gap-2 mt-3">
        ${canAdjust ? `<button class="btn btn-light btn-sm flex-fill" data-count-cyl="${esc(t.id)}"><i class="bi bi-clipboard-check me-1"></i>Count</button>` : ''}
        <a class="btn btn-outline-primary btn-sm flex-fill" href="#/purchases/new"><i class="bi bi-truck me-1"></i>Buy / refill</a>
      </div></div></div>`;
  }).join('') || `<div class="col-12">${emptyState('No cylinder types. Add them in Settings.', 'fuel-pump')}</div>`}</div>
  <p class="small text-body-secondary mt-3 mb-0"><i class="bi bi-info-circle me-1"></i>Full = filled cylinders on the shelf to sell or swap. Empty = cylinders waiting for refill.</p>`;

  body.querySelectorAll('[data-count-cyl]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.countCyl;
    const row = snap.cyl.find((c) => c.id === id) || { full: 0, empty: 0 };
    const t = cylinderType(id);
    const ok = await UI.formModal({
      title: `Count · ${t?.name || id}`, submitLabel: 'Save count',
      body: `<p class="small text-body-secondary">Enter what you physically see. The difference is recorded as an adjustment.</p>
        <div class="row g-2"><div class="col-6"><label class="form-label">Full</label>
          <input class="form-control form-control-lg" name="full" type="number" min="0" step="1" value="${row.full}" inputmode="numeric"></div>
        <div class="col-6"><label class="form-label">Empty</label>
          <input class="form-control form-control-lg" name="empty" type="number" min="0" step="1" value="${row.empty}" inputmode="numeric"></div></div>
        <label class="form-label mt-3">Reason</label><input class="form-control" name="note" maxlength="120" placeholder="e.g. Monthly count">`,
      onSubmit: (v) => Gas.adjustCylinders(id, { full: v.full, empty: v.empty }, v.note || 'Stock count').then(() => true),
    });
    if (ok) { UI.toast('Count saved'); render(page, { params: ['cylinders'], setTitle }); }
  }));
}

// ---------- Gas tank ----------
function drawGas(body, snap, page, setTitle) {
  const cap = num(getSettings().tankCapacityKg);
  const pct = cap ? Math.round(Math.min(1, snap.gasKg / cap) * 100) : 0;
  const canAdjust = Auth.can('stock.adjust');
  body.innerHTML = `<div class="row g-3">
    <div class="col-12 col-lg-6"><div class="card-lift tank-card anim-rise">
      <div class="tank-wrap tank-big">${tankSvg(snap.gasKg, cap)}</div>
      <div class="d-flex justify-content-between mt-3">
        <div><div class="small text-body-secondary">In the tank</div><div class="fs-3 fw-bold"><span data-count="${snap.gasKg}" data-fmt="kg">0</span></div></div>
        <div class="text-end"><div class="small text-body-secondary">Capacity</div><div class="fs-5 fw-semibold">${fmtQty(cap)} kg</div></div>
      </div>
      <div class="progress mt-2"><div class="progress-bar bar-grad" style="width:${pct}%"></div></div>
    </div></div>
    <div class="col-12 col-lg-6">
      <div class="card-lift p-3 anim-rise" style="--d:.1s">
        <div class="fw-semibold mb-2">Gas tank actions</div>
        <p class="small text-body-secondary mb-3">Refills take gas from the tank automatically. Use <b>Tank reading</b> after you check the gauge or weigh the tank, to correct the figure.</p>
        <div class="d-grid gap-2">
          ${canAdjust ? '<button class="btn btn-light" id="gas-read"><i class="bi bi-speedometer2 me-1"></i>Tank reading (set kg)</button>' : ''}
          <a class="btn btn-grad" href="#/purchases/new"><i class="bi bi-truck me-1"></i>Buy bulk gas</a>
        </div>
      </div>
      <div class="card-lift p-3 mt-3 anim-rise" style="--d:.2s">
        <div class="fw-semibold mb-1">Bulk gas to refill cylinders</div>
        <div class="small text-body-secondary">Each refill uses the kg of the cylinder size (e.g. 11.8 kg). Price per kg: <b>${esc(cur())} ${f2(getSettings().gasRate)}</b> — change it in Settings.</div>
      </div>
    </div></div>`;

  body.querySelector('#gas-read')?.addEventListener('click', async () => {
    const ok = await UI.formModal({
      title: 'Tank reading', submitLabel: 'Save reading',
      body: `<label class="form-label fw-semibold">Kilograms in the tank now</label>
        <input class="form-control form-control-lg" name="kg" type="number" min="0" step="0.1" inputmode="decimal" value="${snap.gasKg}" required>
        <label class="form-label mt-3">Note</label><input class="form-control" name="note" maxlength="120" placeholder="e.g. Weighed after delivery">`,
      onSubmit: (v) => Gas.adjustGas(v.kg, v.note || 'Tank reading').then(() => true),
    });
    if (ok) { UI.toast('Tank reading saved'); render(page, { params: ['gas'], setTitle }); }
  });
}

// ---------- Accessories ----------
function drawItems(body, snap, page, setTitle) {
  const canEdit = Auth.can('item.manage');
  const canAdjust = Auth.can('stock.adjust');
  const rows = [...snap.items].sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
  body.innerHTML = `
    <div class="d-flex gap-2 mb-2">
      <div class="search-box flex-grow-1"><i class="bi bi-search"></i>
        <input type="search" class="form-control" id="it-q" placeholder="Search accessory, SKU or barcode" autocomplete="off"></div>
      ${canEdit ? '<button class="btn btn-grad" id="it-add"><i class="bi bi-plus-lg"></i><span class="d-none d-sm-inline ms-1">Add</span></button>' : ''}
    </div>
    <div class="card-lift p-0 overflow-hidden"><div id="it-list"></div></div>`;
  const $b = window.jQuery(body);
  const draw = (q) => {
    const qq = lc(q); const dq = (q || '').trim();
    const list = rows.filter((i) => !qq || i.nameLc.includes(qq) || (i.sku || '').toLowerCase().includes(qq) || (i.barcode && i.barcode === dq));
    pager($b.find('#it-list'), list, (i) => {
      const low = num(i.minStock) > 0 && num(i.stock) <= num(i.minStock);
      return `<div class="list-row item-row ${low ? 'is-low' : ''}" data-item="${esc(i.id)}" role="button" tabindex="0">
        <div class="bill-ico tone-blue"><i class="bi bi-bag"></i></div>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(i.name)}</div>
          <div class="small text-body-secondary">${esc(cur())} ${f2(i.salePrice)} sell · cost ${f2(i.costPrice)}${i.category ? ` · ${esc(i.category)}` : ''}</div></div>
        <div class="text-end"><span class="stock-pill ${i.stock <= 0 ? 'is-zero' : low ? 'is-low' : ''}">${fmtQty(i.stock)}</span>
          <div class="small text-body-secondary">in stock</div></div></div>`;
    }, 50, emptyState('No accessories found', 'bag'));
  };
  draw('');
  $b.find('#it-q').on('input', debounce((e) => draw(e.target.value), 120));
  $b.find('#it-add').on('click', () => itemForm(null, page, setTitle));
  $b.on('click', '[data-item]', (e) => {
    const it = snap.items.find((i) => i.id === e.currentTarget.dataset.item);
    if (it) itemDetail(it, page, setTitle, canEdit, canAdjust);
  });
}

function itemDetail(it, page, setTitle, canEdit, canAdjust) {
  const m = UI.modal({
    title: it.name, size: 'md',
    body: `<div class="d-flex justify-content-between align-items-end mb-3">
        <div><div class="small text-body-secondary">In stock</div><div class="fs-2 fw-bold">${fmtQty(it.stock)}</div></div>
        <div class="text-end small text-body-secondary">Min ${fmtQty(it.minStock)}<br>${it.barcode ? `Barcode ${esc(it.barcode)}` : ''}${it.sku ? `<br>SKU ${esc(it.sku)}` : ''}</div>
      </div>
      <div class="row g-2 small">
        <div class="col-6"><div class="p-2 rounded bg-body-tertiary"><div class="text-body-secondary">Sell price</div><div class="fw-semibold">${esc(cur())} ${f2(it.salePrice)}</div></div></div>
        <div class="col-6"><div class="p-2 rounded bg-body-tertiary"><div class="text-body-secondary">Cost</div><div class="fw-semibold">${esc(cur())} ${f2(it.costPrice)}</div></div></div>
      </div>`,
    footer: `${canAdjust ? '<button class="btn btn-light" id="it-adj">Adjust stock</button>' : ''}${canEdit ? '<button class="btn btn-outline-primary" id="it-edit">Edit</button>' : ''}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  m.$el.find('#it-edit').on('click', () => { m.close(); m.closed.then(() => itemForm(it, page, setTitle)); });
  m.$el.find('#it-adj').on('click', () => { m.close(); m.closed.then(() => adjustItemForm(it, page, setTitle)); });
}

async function itemForm(it, page, setTitle) {
  const e = it || {};
  const ok = await UI.formModal({
    title: it ? 'Edit accessory' : 'New accessory', submitLabel: it ? 'Save changes' : 'Add accessory',
    body: `<div class="mb-3"><label class="form-label fw-semibold">Name</label>
        <input class="form-control form-control-lg" name="name" value="${esc(e.name || '')}" required></div>
      <div class="row g-2 mb-3">
        <div class="col-6"><label class="form-label">Sell price</label><input class="form-control" name="salePrice" type="number" min="0" step="0.01" inputmode="decimal" value="${e.salePrice ?? ''}"></div>
        <div class="col-6"><label class="form-label">Cost price</label><input class="form-control" name="costPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${e.costPrice ?? ''}"></div>
        <div class="col-6"><label class="form-label">Category</label><input class="form-control" name="category" value="${esc(e.category || '')}" placeholder="Regulator, Hose…"></div>
        <div class="col-6"><label class="form-label">Alert below</label><input class="form-control" name="minStock" type="number" min="0" step="1" inputmode="numeric" value="${e.minStock ?? ''}"></div>
        <div class="col-6"><label class="form-label">Barcode</label><input class="form-control" name="barcode" value="${esc(e.barcode || '')}" autocomplete="off"></div>
        <div class="col-6"><label class="form-label">SKU</label><input class="form-control" name="sku" value="${esc(e.sku || '')}"></div>
        ${it ? '' : '<div class="col-12"><label class="form-label">Opening stock</label><input class="form-control" name="openingStock" type="number" min="0" step="1" inputmode="numeric" value="0"></div>'}
      </div>`,
    onSubmit: (v) => Gas.saveItem({
      id: it?.id, name: v.name, sku: v.sku, barcode: v.barcode, category: v.category,
      costPrice: v.costPrice, salePrice: v.salePrice, minStock: v.minStock, openingStock: v.openingStock,
    }).then(() => true),
  });
  if (ok) { UI.toast(it ? 'Accessory saved' : 'Accessory added'); render(page, { params: ['items'], setTitle }); }
}

async function adjustItemForm(it, page, setTitle) {
  const ok = await UI.formModal({
    title: `Adjust · ${it.name}`, submitLabel: 'Save count',
    body: `<label class="form-label fw-semibold">Actual quantity now</label>
      <input class="form-control form-control-lg" name="stock" type="number" min="0" step="0.001" inputmode="decimal" value="${it.stock}" required>
      <label class="form-label mt-3">Reason</label><input class="form-control" name="note" maxlength="120" placeholder="e.g. Damaged, found extra">`,
    onSubmit: (v) => Gas.adjustItem(it.id, num(v.stock), v.note || 'Stock count').then(() => true),
  });
  if (ok) { UI.toast('Stock updated'); render(page, { params: ['items'], setTitle }); }
}

// ---------- Movements ----------
function drawMoves(body, snap) {
  const names = new Map(snap.items.map((i) => [i.id, i.name]));
  const rows = [...snap.moves].sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 200);
  const label = (m) => (m.target === 'gas' ? 'Bulk gas' : m.target === 'cyl' ? (cylinderType(m.targetId)?.name || m.targetId) : (names.get(m.targetId) || 'Accessory'));
  const delta = (m) => {
    if (m.target === 'gas') return `${m.qty > 0 ? '+' : ''}${fmtQty(m.qty)} kg`;
    if (m.target === 'cyl') return [m.full ? `${m.full > 0 ? '+' : ''}${m.full} full` : '', m.empty ? `${m.empty > 0 ? '+' : ''}${m.empty} empty` : ''].filter(Boolean).join(' · ');
    return `${m.qty > 0 ? '+' : ''}${fmtQty(m.qty)}`;
  };
  const KIND = { sale: 'Sale', void: 'Void', purchase: 'Purchase', adjust: 'Count', opening: 'Opening' };
  body.innerHTML = `<div class="card-lift p-0 overflow-hidden">${rows.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0 moves">
    <thead><tr><th>When</th><th>Type</th><th>Item</th><th class="num">Change</th><th>Note</th></tr></thead>
    <tbody>${rows.map((m) => `<tr><td class="text-nowrap small">${fmtDate(m.date)}</td><td><span class="badge text-bg-light border">${esc(KIND[m.kind] || m.kind)}</span></td>
      <td>${esc(label(m))}</td><td class="num fw-semibold ${(m.qty || m.full || m.empty) < 0 ? 'text-danger' : 'text-success'}">${esc(delta(m))}</td>
      <td class="small text-body-secondary">${esc(m.note || '')}</td></tr>`).join('')}</tbody></table></div>`
    : emptyState('No stock movements yet', 'list-ul')}</div>`;
}

