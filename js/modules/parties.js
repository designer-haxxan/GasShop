// Customers and suppliers: balances, add/edit, statements (ledger) and payments.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtDate, today, lc, round2, debounce } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { printHtml, shopHeader } from '../core/print.js';
import { avatar, pageHeader, emptyState } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';
import * as Gas from '../services/gas.js';
import { pager as listPager, plainNum } from '../core/views.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);
const LABEL = { customer: { one: 'Customer', many: 'Customers', owes: 'owes you', ok: 'No dues' }, supplier: { one: 'Supplier', many: 'Suppliers', owes: 'you owe', ok: 'Settled' } };

// Add / edit a customer or supplier. Resolves to the saved row, or undefined when cancelled.
export async function openPartyForm(type, existing = null) {
  const L = LABEL[type];
  const e = existing || {};
  return UI.formModal({
    title: existing ? `Edit ${L.one.toLowerCase()}` : `New ${L.one.toLowerCase()}`,
    submitLabel: existing ? 'Save changes' : `Add ${L.one.toLowerCase()}`,
    body: `
      <div class="mb-3"><label class="form-label fw-semibold">Name</label>
        <input class="form-control form-control-lg" name="name" value="${esc(e.name || '')}" required autocomplete="off"></div>
      <div class="row g-2 mb-3">
        <div class="col-6"><label class="form-label">Phone</label>
          <input class="form-control" name="phone" inputmode="tel" value="${esc(e.phone || '')}"></div>
        <div class="col-6"><label class="form-label">Opening balance</label>
          <input class="form-control" name="openingBalance" type="number" step="0.01" inputmode="decimal" value="${e.openingBalance || ''}" placeholder="0"></div>
      </div>
      <div class="mb-1"><label class="form-label">Address</label>
        <input class="form-control" name="address" value="${esc(e.address || '')}"></div>
      <div class="form-text">${type === 'customer'
        ? 'Opening balance = dues from before this app (use a negative number if they have credit).'
        : 'Opening balance = what you already owe this supplier (negative if they owe you).'}</div>`,
    onSubmit: (v) => Gas.saveParty(type, { id: e.id, name: v.name, phone: v.phone, address: v.address, openingBalance: v.openingBalance }),
  });
}

async function paymentForm(type, party) {
  const L = LABEL[type];
  const ok = await UI.formModal({
    title: type === 'customer' ? `Receive from ${party.name}` : `Pay ${party.name}`,
    submitLabel: type === 'customer' ? 'Receive payment' : 'Record payment',
    body: `<label class="form-label fw-semibold">Amount (${esc(cur())})</label>
      <input class="form-control form-control-lg fw-bold" name="amount" type="number" min="0" step="0.01" inputmode="decimal" required>
      <div class="row g-2 mt-1 mb-3">
        <div class="col-6"><label class="form-label">Method</label>
          <select class="form-select" name="method"><option value="cash">Cash</option><option value="bank">Bank / wallet</option></select></div>
        <div class="col-6"><label class="form-label">Date</label>
          <input class="form-control" name="date" type="date" value="${today()}"></div>
      </div>
      <label class="form-label">Note</label><input class="form-control" name="note" placeholder="Optional" maxlength="200">`,
    onSubmit: (v) => Gas.savePayment({ partyType: type, partyId: party.id, amount: v.amount, method: v.method, date: v.date || today(), note: v.note }),
  });
  return ok;
}

// ---------- List ----------
async function renderList(el, type, setTitle) {
  const L = LABEL[type];
  const store = type === 'customer' ? 'customers' : 'suppliers';
  const [rows, dues] = await Promise.all([read([store], (t) => t.getAll(store)), Gas.partyDues()]);
  const sorted = rows.sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
  setTitle(L.many);
  const owed = round2(rows.reduce((a, r) => a + Math.max(0, dues.get(r.id) || 0), 0));
  const canEdit = type === 'customer' ? Auth.can('customer.edit') : Auth.can('supplier.manage');

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader(L.many, canEdit ? `<button class="btn btn-grad btn-sm" id="p-add"><i class="bi bi-plus-lg me-1"></i>Add ${L.one.toLowerCase()}</button>` : '')}
    <div class="summary-strip card-lift mb-3">
      <div><div class="small text-body-secondary">${type === 'customer' ? 'Total to collect' : 'Total you owe'}</div>
        <div class="fs-4 fw-bold ${type === 'customer' ? 'text-success' : 'text-danger'}">${esc(cur())} ${f2(owed)}</div></div>
      <div class="text-end small text-body-secondary">${rows.length} ${rows.length === 1 ? L.one.toLowerCase() : L.many.toLowerCase()}</div>
    </div>
    <div class="search-box mb-2"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="p-q" placeholder="Search name or phone" autocomplete="off"></div>
    <div class="card-lift p-0 overflow-hidden" id="p-list"></div>
  </div>`;

  const draw = (q) => {
    const qq = lc(q); const digits = (q || '').trim();
    const list = sorted.filter((r) => !qq || r.nameLc.includes(qq) || (r.phone || '').includes(digits));
    listPager(window.jQuery(el).find('#p-list'), list, (r) => {
      const d = round2(dues.get(r.id) || 0);
      const badge = d > 0.004 ? `<span class="badge ${type === 'customer' ? 'text-bg-warning' : 'text-bg-danger'}">${esc(cur())} ${f2(d)}</span>`
        : d < -0.004 ? `<span class="badge text-bg-info">Credit ${esc(cur())} ${f2(-d)}</span>`
        : `<span class="badge text-bg-light border">${L.ok}</span>`;
      return `<a class="list-row" href="#/${type === 'customer' ? 'customers' : 'suppliers'}/${encodeURIComponent(r.id)}">
        ${avatar(r.name, 'avatar-md')}
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(r.name)}</div>
        <div class="small text-body-secondary text-truncate">${esc(r.phone || r.address || '—')}</div></div>
        <div class="text-end">${badge}</div></a>`;
    }, 50, emptyState(q ? 'No matches' : `No ${L.many.toLowerCase()} yet`, type === 'customer' ? 'people' : 'building'));
  };
  draw('');
  el.querySelector('#p-q').addEventListener('input', debounce((e) => draw(e.target.value), 120));
  el.querySelector('#p-add')?.addEventListener('click', async () => {
    const r = await openPartyForm(type);
    if (r) { UI.toast(`${L.one} added`); renderList(el, type, setTitle); }
  });
}

// ---------- Ledger ----------
async function renderLedger(el, type, id, setTitle) {
  const { party, opening, rows, closing } = await Gas.partyLedger(type, id);
  setTitle(party.name);
  const canPay = type === 'customer' ? Auth.can('payment.collect') : Auth.can('purchase.manage');
  const canEdit = type === 'customer' ? Auth.can('customer.edit') : Auth.can('supplier.manage');
  const owes = closing > 0.004;
  const credit = closing < -0.004;

  const body = rows.length ? rows.map((r) => `<tr>
      <td class="text-nowrap">${fmtDate(r.date)}</td>
      <td>${r.route ? `<a href="${r.route}">${esc(r.ref)}</a>` : esc(r.ref || '')}
        <div class="small text-body-secondary">${esc(r.label)}${r.note ? ` · ${esc(r.note)}` : ''}</div></td>
      <td class="num">${r.inc ? f2(r.inc) : ''}</td>
      <td class="num">${r.dec ? f2(r.dec) : ''}</td>
      <td class="num fw-semibold">${f2(r.balance)}</td></tr>`).join('')
    : `<tr><td colspan="5" class="text-center text-body-secondary py-4">No transactions yet</td></tr>`;

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader(party.name, canEdit ? '<button class="btn btn-light btn-sm" id="l-edit"><i class="bi bi-pencil"></i></button>' : '', type === 'customer' ? '#/customers' : '#/suppliers')}
    <section class="ledger-hero card-lift mb-3 ${owes ? 'is-owed' : credit ? 'is-credit' : ''}">
      <div class="d-flex flex-wrap justify-content-between gap-3">
        <div>
          <div class="small text-body-secondary">${owes ? (type === 'customer' ? 'Balance to collect' : 'You owe') : credit ? 'Credit held' : 'Settled'}</div>
          <div class="ledger-amt" data-count="${round2(Math.abs(closing))}" data-fmt="money">${esc(cur())} ${f2(Math.abs(closing))}</div>
          <div class="small text-body-secondary">${esc(party.phone || '')}${party.phone && party.address ? ' · ' : ''}${esc(party.address || '')}</div>
        </div>
        ${canPay ? `<div class="d-flex flex-column gap-2 align-self-center">
          <button class="btn ${type === 'customer' ? 'btn-success' : 'btn-danger'} btn-pay" id="l-pay"><i class="bi bi-${type === 'customer' ? 'cash-stack' : 'send'} me-1"></i>${type === 'customer' ? 'Receive payment' : 'Pay supplier'}</button>
        </div>` : ''}
      </div>
    </section>
    <div class="d-flex justify-content-between align-items-center mb-2">
      <div class="section-title mb-0"><i class="bi bi-journal-text"></i> Statement</div>
      <button class="btn btn-light btn-sm" id="l-print"><i class="bi bi-printer me-1"></i>Print</button>
    </div>
    <div class="card-lift p-0 overflow-hidden">
      <div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 statement">
        <thead><tr><th>Date</th><th>Ref</th><th class="num">${type === 'customer' ? 'Charged' : 'Bought'}</th><th class="num">${type === 'customer' ? 'Received' : 'Paid'}</th><th class="num">Balance</th></tr></thead>
        <tbody><tr class="table-light"><td colspan="4">Opening balance</td><td class="num fw-semibold">${f2(opening)}</td></tr>${body}</tbody>
      </table></div>
    </div>
  </div>`;

  UI.countUp(el, (n) => `${cur()} ${f2(n)}`);
  const $el = window.jQuery(el);
  $el.find('#l-pay').on('click', async () => {
    const ok = await paymentForm(type, party);
    if (ok) { UI.toast(type === 'customer' ? 'Payment received' : 'Payment recorded'); renderLedger(el, type, id, setTitle); }
  });
  $el.find('#l-edit').on('click', async () => {
    const r = await openPartyForm(type, party);
    if (r) { UI.toast('Saved'); renderLedger(el, type, id, setTitle); }
  });
  $el.find('#l-print').on('click', () => printStatement(type, party, opening, rows, closing));
}

function printStatement(type, party, opening, rows, closing) {
  const body = rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.label)} ${esc(r.ref || '')}</td>
      <td class="num">${r.inc ? plainNum(r.inc) : ''}</td><td class="num">${r.dec ? plainNum(r.dec) : ''}</td><td class="num">${plainNum(r.balance)}</td></tr>`).join('');
  printHtml(`<div class="receipt wide">${shopHeader()}
    <div class="pr-meta"><div><b>Statement: ${esc(party.name)}</b></div><div>As of ${fmtDate(today())}</div></div>
    <table class="pr-table"><thead><tr><th>Date</th><th>Ref</th><th class="num">Charged</th><th class="num">Received</th><th class="num">Balance</th></tr></thead>
    <tbody><tr><td colspan="4">Opening balance</td><td class="num">${plainNum(opening)}</td></tr>${body}
    <tr class="pr-grand"><td colspan="4">Closing balance</td><td class="num">${plainNum(closing)}</td></tr></tbody></table></div>`,
  `Statement ${party.name}`);
}

export async function render(el, { route, params, setTitle }) {
  const type = route === 'suppliers' ? 'supplier' : 'customer';
  if (params[0]) return renderLedger(el, type, params[0], setTitle);
  return renderList(el, type, setTitle);
}

