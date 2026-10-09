// Printing: renders a document into #print-area and opens the system print dialog.
// The CSS in app.css shows #print-area only while printing.
import { esc, fmtDateTime, fmtNum, fmtQty } from './utils.js';
import { getSettings } from './settings.js';

export function shopHeader() {
  const { shop } = getSettings();
  return `<header class="pr-head">
      <div class="pr-brand">
        <div class="pr-name">${esc(shop.name)}</div>
        ${shop.tagline ? `<div class="pr-tag">${esc(shop.tagline)}</div>` : ''}
        ${shop.address ? `<div class="pr-small">${esc(shop.address)}</div>` : ''}
        <div class="pr-small">${[shop.phone && `Tel: ${esc(shop.phone)}`, shop.license && `Lic: ${esc(shop.license)}`].filter(Boolean).join(' · ')}</div>
      </div>
    </header>`;
}

// Opens the print dialog with the given HTML body (already escaped by the caller).
export function printHtml(html, title = 'Print') {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const prev = document.title;
  document.title = title;
  const done = () => { document.title = prev; area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Give fonts a tick to lay out before the dialog opens.
  setTimeout(() => window.print(), 60);
}

// Lines are the bill/purchase lines as stored (see services/gas.js for their shape).
export function lineDescription(l) {
  if (l.kind === 'refill') return `Gas refill ${fmtQty(l.kg)} kg (${l.qty} × ${esc(l.name)})`;
  if (l.kind === 'cyl') return `${esc(l.name)} · out ${l.out} / empty in ${l.in}`;
  if (l.kind === 'item') return esc(l.name);
  if (l.kind === 'cylFull') return `${esc(l.name)} filled, bought`;
  if (l.kind === 'refillPlant') return `${esc(l.name)} refilled at plant`;
  if (l.kind === 'gasBulk') return `Bulk gas ${fmtQty(l.kg)} kg`;
  return esc(l.name || '');
}

export function receiptHtml(bill) {
  const { shop, currency } = getSettings();
  const cur = esc(currency);
  const rows = bill.lines.map((l) => `<tr>
      <td colspan="2">${lineDescription(l)}</td></tr>
    <tr class="pr-sub"><td>${l.kind === 'refill' ? `${fmtQty(l.kg)} kg × ${cur} ${fmtNum(l.rate)}/kg` : l.kind === 'cyl' ? `${l.out} × ${cur} ${fmtNum(l.rate)}` : `${fmtQty(l.qty)} × ${fmtNum(l.rate)}`}</td>
      <td class="num">${fmtNum(l.amount)}</td></tr>`).join('');
  return `<div class="receipt">
    ${shopHeader()}
    <div class="pr-meta">
      <div><b>${esc(bill.number)}</b></div>
      <div>${fmtDateTime(bill.createdAt)}</div>
      <div>Customer: ${esc(bill.customerName || 'Walk-in')}</div>
    </div>
    <table class="pr-table"><tbody>${rows}</tbody></table>
    <table class="pr-table pr-totals"><tbody>
      <tr><td>Subtotal</td><td class="num">${fmtNum(bill.subtotal)}</td></tr>
      ${bill.discount ? `<tr><td>Discount</td><td class="num">-${fmtNum(bill.discount)}</td></tr>` : ''}
      <tr class="pr-grand"><td>Total (${cur})</td><td class="num">${fmtNum(bill.total)}</td></tr>
      <tr><td>Paid (${esc(bill.method)})</td><td class="num">${fmtNum(bill.paid)}</td></tr>
      ${bill.due > 0.004 ? `<tr><td>Balance due</td><td class="num">${fmtNum(bill.due)}</td></tr>` : ''}
    </tbody></table>
    <div class="pr-foot">${esc(shop.footer || '')}</div>
  </div>`;
}
