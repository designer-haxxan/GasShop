// Bills: list with date filter, detail view, receipt printing and voiding (managers).
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtQty, fmtDate, fmtDateTime, today, monthStart, lc, debounce, round2 } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { printHtml, receiptHtml } from '../core/print.js';
import { pageHeader, emptyState, errorState } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';
import * as Gas from '../services/gas.js';
import { dateFilter, bindDateFilter, pager } from '../core/views.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);

function kindLabel(l) {
  if (l.kind === 'refill') return `Gas refill · ${l.qty} cyl (${fmtQty(l.kg)} kg)`;
  if (l.kind === 'cyl') return `${esc(l.name)} · ${l.out} full out, ${l.in} empty in`;
  return esc(l.name);
}

export async function render(el, { params, setTitle }) {
  if (params[0]) return renderDetail(el, params[0], setTitle);
  setTitle('Sales & Bills');
  const from = monthStart(); const to = today();

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Sales & Bills', '<a class="btn btn-grad btn-sm" href="#/pos"><i class="bi bi-cart-plus me-1"></i>New sale</a>')}
    <div class="card-lift p-3 mb-3">${dateFilter(from, to)}</div>
    <div class="summary-strip card-lift mb-3" id="s-sum"></div>
    <div class="search-box mb-2"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="s-q" placeholder="Search bill number or customer" autocomplete="off"></div>
    <div class="card-lift p-0 overflow-hidden" id="s-list"></div>
  </div>`;

  const $el = window.jQuery(el);
  let all = [];
  const draw = () => {
    const q = lc($el.find('#s-q').val());
    const rows = all.filter((b) => !q || lc(b.number).includes(q) || lc(b.customerName).includes(q));
    const live = rows.filter((b) => b.status !== 'void');
    const total = round2(live.reduce((a, b) => a + b.total, 0));
    const due = round2(live.reduce((a, b) => a + b.due, 0));
    $el.find('#s-sum').html(`<div><div class="small text-body-secondary">Sales in range</div><div class="fs-4 fw-bold">${esc(cur())} ${f2(total)}</div></div>
      <div class="text-end"><div class="small text-body-secondary">${live.length} bills</div><div class="small">${esc(cur())} ${f2(due)} on credit</div></div>`);
    pager($el.find('#s-list'), rows, (b) => `<a class="list-row ${b.status === 'void' ? 'is-void' : ''}" href="#/sales/${encodeURIComponent(b.id)}">
        <div class="bill-ico"><i class="bi bi-receipt"></i></div>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold text-truncate">${esc(b.customerName)} <span class="small text-body-secondary fw-normal">${esc(b.number)}</span></div>
          <div class="small text-body-secondary">${fmtDate(b.date)}${b.createdAt ? ` · ${new Date(b.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
        </div>
        <div class="text-end">
          <div class="fw-bold">${esc(cur())} ${f2(b.total)}</div>
          ${b.status === 'void' ? '<span class="badge text-bg-secondary">Void</span>'
            : b.due > 0.004 ? '<span class="badge text-bg-warning">Due ' + f2(b.due) + '</span>'
            : '<span class="badge text-bg-success-subtle text-success-emphasis">Paid</span>'}
        </div></a>`, 40, emptyState('No bills in this period', 'receipt'));
  };

  const load = async (f, t) => {
    all = (await read(['bills'], (tx) => tx.getAll('bills')))
      .filter((b) => b.date >= f && b.date <= t)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    draw();
  };
  bindDateFilter($el, load);
  $el.find('#s-q').on('input', debounce(draw, 150));
  await load(from, to);
}

async function renderDetail(el, id, setTitle) {
  const b = await read(['bills'], (t) => t.get('bills', id));
  if (!b) { el.innerHTML = errorState(new Error('Bill not found.')); return; }
  setTitle(b.number);
  const canVoid = b.status !== 'void' && Auth.can('sale.void');
  const isVoid = b.status === 'void';

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader(b.number, `<button class="btn btn-light btn-sm" id="b-print"><i class="bi bi-printer me-1"></i>Print</button>`, '#/sales')}
    <section class="card-lift p-3 mb-3 ${isVoid ? 'is-void' : ''}">
      <div class="d-flex flex-wrap justify-content-between gap-2">
        <div>
          <div class="fs-5 fw-bold">${esc(b.customerName)}</div>
          <div class="small text-body-secondary">${fmtDateTime(b.createdAt)} · ${esc(b.method)}</div>
          ${b.customerId ? `<a class="small" href="#/customers/${encodeURIComponent(b.customerId)}">Open customer ledger</a>` : ''}
        </div>
        <div class="text-end">
          ${isVoid ? '<span class="badge text-bg-secondary fs-6">Void</span>' : b.due > 0.004 ? '<span class="badge text-bg-warning fs-6">Balance due</span>' : '<span class="badge text-bg-success fs-6">Paid</span>'}
          <div class="fs-3 fw-bold mt-1">${esc(cur())} ${f2(b.total)}</div>
        </div>
      </div>
      ${isVoid ? `<div class="alert alert-secondary small mt-3 mb-0">Voided ${fmtDateTime(b.voidedAt)}${b.voidReason ? ` — ${esc(b.voidReason)}` : ''}. Stock was returned.</div>` : ''}
    </section>
    <div class="card-lift p-0 overflow-hidden mb-3">
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Item</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${b.lines.map((l) => `<tr><td>${kindLabel(l)}</td>
          <td class="num small">${l.kind === 'refill' ? `${esc(cur())} ${f2(l.rate)}/kg` : `${esc(cur())} ${f2(l.rate)}`}</td>
          <td class="num fw-semibold">${f2(l.amount)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="2" class="text-end text-body-secondary">Subtotal</td><td class="num">${f2(b.subtotal)}</td></tr>
          ${b.discount ? `<tr><td colspan="2" class="text-end text-body-secondary">Discount</td><td class="num">-${f2(b.discount)}</td></tr>` : ''}
          <tr class="fw-bold"><td colspan="2" class="text-end">Total</td><td class="num">${f2(b.total)}</td></tr>
          <tr><td colspan="2" class="text-end text-body-secondary">Received</td><td class="num">${f2(b.paid)}</td></tr>
          ${b.due > 0.004 ? `<tr class="text-warning-emphasis"><td colspan="2" class="text-end">Balance on credit</td><td class="num">${f2(b.due)}</td></tr>` : ''}
        </tfoot>
      </table></div>
    </div>
    ${canVoid ? `<button class="btn btn-outline-danger" id="b-void"><i class="bi bi-x-octagon me-1"></i>Void this bill</button>
      <div class="form-text">Voiding returns the cylinders, gas and accessories to stock and cancels the balance on credit.</div>` : ''}
  </div>`;

  const $el = window.jQuery(el);
  $el.find('#b-print').on('click', () => printHtml(receiptHtml(b), b.number));
  $el.find('#b-void').on('click', async () => {
    const ok = await UI.formModal({
      title: `Void ${b.number}?`, submitLabel: 'Void bill', submitClass: 'btn-danger',
      body: `<p class="small">This cannot be undone. Use it for mistakes or cancelled orders.</p>
        <label class="form-label">Reason</label><input class="form-control" name="reason" maxlength="200" placeholder="e.g. Entered by mistake" required>`,
      onSubmit: (v) => {
        if (!String(v.reason || '').trim()) throw new Error('Enter a reason for voiding.');
        return Gas.voidSale(id, v.reason).then(() => true);
      },
    });
    if (ok) { UI.toast('Bill voided', 'warning'); renderDetail(el, id, setTitle); }
  });
}

