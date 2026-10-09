// Expenses and cash: money in and out for a date range, expenses by category, add/delete expenses.
import { read } from '../db/idb.js';
import { esc, fmtNum, fmtDate, today, monthStart, round2, num } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { pageHeader, emptyState } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';
import * as Gas from '../services/gas.js';
import { dateFilter, bindDateFilter } from '../core/views.js';

const cur = () => getSettings().currency;
const f2 = (n) => fmtNum(n);

export async function render(el, { setTitle }) {
  setTitle('Expenses & Cash');
  const canManage = Auth.can('expense.manage');
  const from = monthStart(); const to = today();

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Expenses & Cash', canManage ? '<button class="btn btn-grad btn-sm" id="ex-add"><i class="bi bi-plus-lg me-1"></i>Add expense</button>' : '')}
    <div class="card-lift p-3 mb-3">${dateFilter(from, to)}</div>
    <div id="ex-body"></div>
  </div>`;

  const $el = window.jQuery(el);
  const load = async (f, t) => {
    const [cash, expenses] = await Promise.all([
      Gas.cashSummary(f, t),
      read(['expenses'], (tx) => tx.getAll('expenses')),
    ]);
    const list = expenses.filter((e) => e.date >= f && e.date <= t).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
    const byCat = new Map();
    for (const e of list) byCat.set(e.category, round2((byCat.get(e.category) || 0) + e.amount));
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const max = cats[0]?.[1] || 1;

    $el.find('#ex-body').html(`
      <div class="row g-2 mb-3">
        <div class="col-4"><div class="kpi card-lift anim-rise"><div class="kpi-icon tone-green"><i class="bi bi-arrow-down-circle"></i></div>
          <div class="small text-body-secondary">Cash in</div><div class="kpi-value text-success fs-5">${esc(cur())} ${f2(cash.cashIn)}</div>
          <div class="small text-body-secondary text-truncate">Sales ${f2(cash.salesPaid)} + dues ${f2(cash.receipts)}</div></div></div>
        <div class="col-4"><div class="kpi card-lift anim-rise" style="--d:.05s"><div class="kpi-icon tone-red"><i class="bi bi-arrow-up-circle"></i></div>
          <div class="small text-body-secondary">Cash out</div><div class="kpi-value text-danger fs-5">${esc(cur())} ${f2(cash.cashOut)}</div>
          <div class="small text-body-secondary text-truncate">Buys ${f2(cash.purchasesPaid + cash.supplierPaid)} + exp. ${f2(cash.expenses)}</div></div></div>
        <div class="col-4"><div class="kpi card-lift anim-rise" style="--d:.1s"><div class="kpi-icon ${cash.net >= 0 ? 'tone-blue' : 'tone-red'}"><i class="bi bi-wallet2"></i></div>
          <div class="small text-body-secondary">Net cash</div><div class="kpi-value fs-5 ${cash.net >= 0 ? '' : 'text-danger'}">${esc(cur())} ${f2(cash.net)}</div>
          <div class="small text-body-secondary">for this period</div></div></div>
      </div>
      <div class="row g-3">
        <div class="col-12 col-lg-5"><div class="card-lift p-3 h-100 anim-rise">
          <div class="fw-semibold mb-2">Expenses by category</div>
          ${cats.length ? cats.map(([c, v], i) => `<div class="bar-row" style="--d:${i * 0.06}s">
              <div class="d-flex justify-content-between small"><span class="text-truncate">${esc(c)}</span><span class="fw-semibold">${esc(cur())} ${f2(v)}</span></div>
              <div class="bar-track"><div class="bar-fill" style="width:${((v / max) * 100).toFixed(1)}%"></div></div></div>`).join('')
            : '<div class="small text-body-secondary py-3 text-center">No expenses in this period.</div>'}
        </div></div>
        <div class="col-12 col-lg-7"><div class="card-lift p-0 overflow-hidden anim-rise">
          <div class="px-3 pt-3 fw-semibold">Expense list</div>
          ${list.length ? list.map((e) => `<div class="list-row">
              <div class="bill-ico tone-violet"><i class="bi bi-wallet"></i></div>
              <div class="flex-grow-1 min-w-0"><div class="fw-medium text-truncate">${esc(e.category)}</div>
                <div class="small text-body-secondary text-truncate">${fmtDate(e.date)}${e.note ? ` · ${esc(e.note)}` : ''}</div></div>
              <div class="fw-bold text-nowrap">${esc(cur())} ${f2(e.amount)}</div>
              ${canManage ? `<button class="btn btn-link btn-sm text-danger p-0 ms-2" data-del="${esc(e.id)}" aria-label="Delete expense"><i class="bi bi-trash"></i></button>` : ''}
            </div>`).join('') : emptyState('No expenses in this period', 'wallet2')}
        </div></div>
      </div>`);
  };

  bindDateFilter($el, (f, t) => load(f, t));
  $el.on('click', '#ex-add', () => expenseForm(() => load(from, to)));
  $el.on('click', '[data-del]', async (e) => {
    const ok = await UI.confirmDialog('Delete this expense? It will no longer count in the cash book.', { okLabel: 'Delete', okClass: 'btn-danger' });
    if (!ok) return;
    try { await Gas.deleteExpense(e.currentTarget.dataset.del); UI.toast('Expense deleted'); load(from, to); } catch (err) { UI.toastError(err); }
  });
  await load(from, to);
}

async function expenseForm(done) {
  const cats = getSettings().expenseCategories;
  const ok = await UI.formModal({
    title: 'Add expense', submitLabel: 'Save expense',
    body: `<div class="row g-2 mb-3">
        <div class="col-7"><label class="form-label fw-semibold">Category</label>
          <select class="form-select form-select-lg" name="category">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="col-5"><label class="form-label fw-semibold">Amount</label>
          <input class="form-control form-control-lg" name="amount" type="number" min="0" step="0.01" inputmode="decimal" required></div>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-6"><label class="form-label">Date</label><input class="form-control" name="date" type="date" value="${today()}"></div>
      </div>
      <label class="form-label">Note</label><input class="form-control" name="note" maxlength="200" placeholder="Optional">`,
    onSubmit: (v) => Gas.saveExpense({ date: v.date || today(), category: v.category, amount: num(v.amount), note: v.note }).then(() => true),
  });
  if (ok) { UI.toast('Expense saved'); done(); }
}
