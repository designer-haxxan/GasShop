// Reusable view fragments: money formatting, date filters, paged lists.
import { esc, fmtNum, today, monthStart } from './utils.js';
import { getSettings } from './settings.js';

const $ = window.jQuery;

export const cur = () => getSettings().currency;
export const money = (n) => `${esc(cur())} ${fmtNum(n)}`;
export const moneyPlain = (n) => `${cur()} ${fmtNum(n)}`;

export function dateFilter(from, to, extra = '') {
  return `<form class="filters date-filter">
    <div><label class="form-label small mb-0">From</label><input type="date" name="from" class="form-control form-control-sm" value="${esc(from)}"></div>
    <div><label class="form-label small mb-0">To</label><input type="date" name="to" class="form-control form-control-sm" value="${esc(to)}"></div>
    ${extra}
    <div class="d-flex align-items-end gap-1" style="flex:0 0 auto">
      <div class="btn-group btn-group-sm">
        <button type="button" class="btn btn-outline-secondary" data-range="today">Today</button>
        <button type="button" class="btn btn-outline-secondary" data-range="month">Month</button>
        <button type="button" class="btn btn-outline-secondary" data-range="all">All</button>
      </div>
      <button class="btn btn-primary btn-sm">Apply</button>
    </div></form>`;
}
export function rangeFor(key) {
  if (key === 'today') return [today(), today()];
  if (key === 'month') return [monthStart(), today()];
  return ['2000-01-01', today()];
}
// Wires the quick-range buttons and the Apply button; calls cb(from, to, values) on apply.
export function bindDateFilter($root, cb) {
  $root.on('click', '.date-filter [data-range]', function () {
    const [f, t] = rangeFor(this.dataset.range);
    const $f = $(this).closest('form');
    $f.find('[name=from]').val(f); $f.find('[name=to]').val(t);
    $f.trigger('submit');
  });
  $root.on('submit', '.date-filter', function (e) {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(this).entries());
    cb(fd.from || '2000-01-01', fd.to || today(), fd);
  });
}

// Incremental "show more" list rendering (keeps the DOM small on long lists).
export function pager($container, items, rowFn, pageSize = 40, empty = '') {
  let shown = 0;
  const more = () => {
    const chunk = items.slice(shown, shown + pageSize);
    shown += chunk.length;
    $container.find('.pager-more').remove();
    $container.append(chunk.map(rowFn).join(''));
    if (shown < items.length) $container.append(`<button class="list-row pager-more justify-content-center text-primary">Show more (${items.length - shown} remaining)</button>`);
  };
  $container.empty();
  if (!items.length) { $container.html(empty); return; }
  $container.off('click.pager').on('click.pager', '.pager-more', more);
  more();
}

// Escape-safe CSV-ready number for reports (no thousands separators).
export const plainNum = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
