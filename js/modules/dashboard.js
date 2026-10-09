// Home screen: today at a glance — gas tank, cylinders, sales, dues and low-stock alerts.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtQty, fmtTime, today, num, round2, fmtDate } from '../core/utils.js';
import { getSettings, cylinderType } from '../core/settings.js';
import { cylinderSvg, tankSvg, animateVisuals } from '../core/visuals.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';
import { partyDues } from '../services/gas.js';

const cur = () => getSettings().currency;
const money = (n) => `<span data-count="${round2(n)}" data-fmt="money">${esc(cur())} ${fmtNum(n)}</span>`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export async function render(el, { setTitle }) {
  setTitle('Dashboard');
  const s = getSettings();
  const d = today();

  const snap = await read(['meta', 'cylStock', 'items', 'bills', 'customers', 'suppliers'], async (t) => ({
    gasKg: num((await t.get('meta', 'gasKg'))?.value),
    cyl: await t.getAll('cylStock'),
    items: await t.getAll('items'),
    bills: await t.getAll('bills'),
    customers: await t.getAll('customers'),
    suppliers: await t.getAll('suppliers'),
  }));
  const dues = await partyDues();

  const live = snap.bills.filter((b) => b.status !== 'void');
  const todays = live.filter((b) => b.date === d);
  const salesToday = round2(todays.reduce((a, b) => a + b.total, 0));
  const cashToday = round2(todays.reduce((a, b) => a + b.paid, 0));
  const kgToday = round2(todays.flatMap((b) => b.lines).filter((l) => l.kind === 'refill').reduce((a, l) => a + l.kg, 0));
  const outToday = todays.flatMap((b) => b.lines).filter((l) => l.kind === 'cyl').reduce((a, l) => a + l.out, 0);
  const inToday = todays.flatMap((b) => b.lines).filter((l) => l.kind === 'cyl').reduce((a, l) => a + l.in, 0);
  const customerOwed = round2(snap.customers.reduce((a, c) => a + Math.max(0, dues.get(c.id) || 0), 0));
  const supplierOwed = round2(snap.suppliers.reduce((a, c) => a + Math.max(0, dues.get(c.id) || 0), 0));
  const lowStock = snap.items.filter((i) => num(i.minStock) > 0 && num(i.stock) <= num(i.minStock))
    .sort((a, b) => a.stock - b.stock);
  const recent = [...live].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5);
  const cap = num(s.tankCapacityKg);
  const tankPct = cap > 0 ? Math.min(1, snap.gasKg / cap) : 0;
  const setupNeeded = !(s.gasRate > 0) || s.cylinderTypes.some((t) => !(t.price > 0));
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  const cylCards = s.cylinderTypes.map((t) => {
    const row = snap.cyl.find((c) => c.id === t.id) || { full: 0, empty: 0 };
    const total = row.full + row.empty;
    const tone = t.kg >= 15 ? 'water' : 'flame';
    return `<div class="col-6 col-xl-4"><div class="cyl-card card-lift h-100">
        <div class="cyl-name fw-semibold">${esc(t.name)}</div>
        <div class="d-flex gap-2 align-items-center mt-1">
          ${cylinderSvg(total ? row.full / total : 0, { tone, label: `${t.name}: ${row.full} full` })}
          <div class="min-w-0">
            <div class="cyl-count"><span class="fw-bold" data-count="${row.full}" data-fmt="int">0</span> <span class="small text-body-secondary">full</span></div>
            <div class="small text-body-secondary">${row.empty} empty</div>
          </div>
        </div></div></div>`;
  }).join('') || UI.emptyState('No cylinder types yet. Add them in Settings.', 'fuel-pump');

  el.innerHTML = `
  <div class="dash">
    <section class="hero-card anim-rise">
      <div class="hero-flame" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="position-relative">
        <div class="small text-white-50 text-uppercase fw-semibold">${esc(dateLabel)}</div>
        <h1 class="h3 fw-bold text-white mb-1">${greeting()}, ${esc(Auth.user()?.name || '')}</h1>
        <div class="text-white-50">${esc(s.shop.name)}${s.shop.tagline ? ` · ${esc(s.shop.tagline)}` : ''}</div>
        <div class="d-flex flex-wrap gap-2 mt-3">
          <a href="#/pos" class="btn btn-light btn-sm fw-semibold btn-pop"><i class="bi bi-cart-plus-fill me-1"></i>New counter sale</a>
          <a href="#/stock" class="btn btn-outline-light btn-sm"><i class="bi bi-boxes me-1"></i>Stock</a>
        </div>
      </div>
    </section>

    ${setupNeeded ? `<div class="setup-note card-lift anim-rise mt-3">
      <div class="setup-ico"><i class="bi bi-tools"></i></div>
      <div class="flex-grow-1 small">Finish setup: set the <b>gas price per kg</b> and the <b>swap price</b> of each cylinder so bills total correctly.</div>
      <a class="btn btn-sm btn-grad" href="#/settings">Open settings</a></div>` : ''}

    <div class="row g-3 mt-1">
      <div class="col-12 col-lg-5">
        <section class="card-lift tank-card anim-rise h-100" style="--d:.05s">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold"><i class="bi bi-fuel-pump me-1 text-flame"></i>Bulk gas tank</div>
            <a class="small" href="#/stock/gas">Read tank</a>
          </div>
          <div class="tank-wrap">${tankSvg(snap.gasKg, cap)}</div>
          <div class="d-flex justify-content-between small text-body-secondary mt-2">
            <span><b class="text-body">${fmtQty(snap.gasKg)}</b> kg in tank</span>
            <span>Capacity ${fmtQty(cap)} kg</span>
          </div>
          <div class="progress mt-2" role="progressbar" aria-label="Tank level" aria-valuenow="${Math.round(tankPct * 100)}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar bar-grad" style="width:${(tankPct * 100).toFixed(1)}%"></div></div>
        </section>
      </div>
      <div class="col-12 col-lg-7">
        <div class="section-title"><i class="bi bi-circle-half"></i> Cylinders in shop</div>
        <div class="row g-2">${cylCards}</div>
      </div>
    </div>

    <div class="row g-2 mt-1">
      <div class="col-6 col-md-3"><div class="kpi card-lift anim-rise" style="--d:.1s">
        <div class="kpi-icon tone-flame"><i class="bi bi-receipt"></i></div>
        <div class="small text-body-secondary">Sales today</div>
        <div class="kpi-value">${money(salesToday)}</div>
        <div class="small text-body-secondary">${todays.length} bill${todays.length === 1 ? '' : 's'}</div></div></div>
      <div class="col-6 col-md-3"><div class="kpi card-lift anim-rise" style="--d:.15s">
        <div class="kpi-icon tone-green"><i class="bi bi-cash-coin"></i></div>
        <div class="small text-body-secondary">Collected today</div>
        <div class="kpi-value">${money(cashToday)}</div>
        <div class="small text-body-secondary">Cash &amp; bank</div></div></div>
      <div class="col-6 col-md-3"><div class="kpi card-lift anim-rise" style="--d:.2s">
        <div class="kpi-icon tone-blue"><i class="bi bi-droplet-half"></i></div>
        <div class="small text-body-secondary">Gas refilled today</div>
        <div class="kpi-value"><span data-count="${kgToday}" data-fmt="kg">0</span></div>
        <div class="small text-body-secondary">kilograms</div></div></div>
      <div class="col-6 col-md-3"><div class="kpi card-lift anim-rise" style="--d:.25s">
        <div class="kpi-icon tone-violet"><i class="bi bi-arrow-left-right"></i></div>
        <div class="small text-body-secondary">Cylinders swapped</div>
        <div class="kpi-value"><span data-count="${outToday}" data-fmt="int">0</span> <small class="text-body-secondary">out</small> · <span data-count="${inToday}" data-fmt="int">0</span> <small class="text-body-secondary">in</small></div>
        <div class="small text-body-secondary">today</div></div></div>
    </div>

    <div class="row g-2 mt-1">
      <div class="col-12 col-lg-5">
        <div class="card-lift dues-card anim-rise h-100" style="--d:.3s">
          <div class="fw-semibold mb-2"><i class="bi bi-wallet2 me-1"></i>Money to collect &amp; pay</div>
          <div class="d-flex justify-content-between align-items-end">
            <div><div class="small text-body-secondary">Customers owe you</div><div class="fs-4 fw-bold text-success">${money(customerOwed)}</div></div>
            <div class="text-end"><div class="small text-body-secondary">You owe suppliers</div><div class="fs-4 fw-bold text-danger">${money(supplierOwed)}</div></div>
          </div>
          <div class="d-flex gap-2 mt-3">
            <a href="#/customers" class="btn btn-sm btn-outline-success flex-fill">Customers</a>
            <a href="#/suppliers" class="btn btn-sm btn-outline-danger flex-fill">Suppliers</a>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-7">
        <div class="card-lift anim-rise h-100" style="--d:.35s">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold"><i class="bi bi-exclamation-triangle me-1 text-warning"></i>Low stock accessories</div>
            <a class="small" href="#/stock/items">All stock</a>
          </div>
          ${lowStock.length ? lowStock.slice(0, 5).map((i) => `<div class="list-row-static">
              <div class="flex-grow-1 min-w-0"><div class="text-truncate fw-medium">${esc(i.name)}</div></div>
              <span class="badge ${i.stock <= 0 ? 'text-bg-danger' : 'text-bg-warning'}">${fmtQty(i.stock)} left</span></div>`).join('')
            : '<div class="small text-body-secondary py-3 text-center"><i class="bi bi-check-circle text-success me-1"></i>Everything is above its minimum level.</div>'}
        </div>
      </div>
    </div>

    <div class="section-title mt-3"><i class="bi bi-lightning-charge"></i> Quick actions</div>
    <div class="quick-grid">
      <a class="quick card-lift" href="#/pos"><span class="quick-ico tone-flame"><i class="bi bi-fire"></i></span><span>Refill / Swap</span></a>
      <a class="quick card-lift" href="#/pos"><span class="quick-ico tone-blue"><i class="bi bi-bag-plus"></i></span><span>Sell accessory</span></a>
      <a class="quick card-lift" href="#/purchases/new"><span class="quick-ico tone-green"><i class="bi bi-truck"></i></span><span>Buy gas / cylinders</span></a>
      <a class="quick card-lift" href="#/expenses"><span class="quick-ico tone-violet"><i class="bi bi-wallet"></i></span><span>Add expense</span></a>
    </div>

    <div class="section-title mt-3"><i class="bi bi-clock-history"></i> Recent bills</div>
    <div class="card-lift p-0 overflow-hidden anim-rise">
      ${recent.length ? recent.map((b) => `<a class="list-row" href="#/sales/${encodeURIComponent(b.id)}">
          <div class="flex-grow-1 min-w-0"><div class="fw-medium text-truncate">${esc(b.customerName)}</div>
          <div class="small text-body-secondary">${esc(b.number)} · ${fmtDate(b.date)} ${b.createdAt ? fmtTime(b.createdAt) : ''}</div></div>
          <div class="text-end"><div class="fw-semibold">${esc(cur())} ${fmtNum(b.total)}</div>
          ${b.due > 0 ? '<span class="badge text-bg-warning">Due</span>' : '<span class="badge text-bg-success-subtle text-success-emphasis">Paid</span>'}</div></a>`).join('')
        : UI.emptyState('No bills yet. Make your first counter sale.', 'receipt', '<a class="btn btn-primary btn-sm mt-2" href="#/pos">Start a sale</a>')}
    </div>
  </div>`;

  UI.countUp(el, (n, node) => {
    if (node.dataset.fmt === 'kg') return `${fmtQty(n)} kg`;
    if (node.dataset.fmt === 'money') return `${cur()} ${fmtNum(n)}`;
    return String(Math.round(n));
  });
  animateVisuals(el);
}
