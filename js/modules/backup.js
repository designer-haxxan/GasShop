// Backup & restore: the whole business database as one JSON file, validated before any data is replaced.
import { read, write } from '../db/idb.js';
import { esc, fmtDateTime, localDate, downloadFile, num } from '../core/utils.js';
import { getSettings, replaceSettings } from '../core/settings.js';
import { CONFIG } from '../config.js';
import { DATA_STORES } from '../db/schema.js';
import { pageHeader } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';

const FORMAT = 'gasshop-backup';

async function exportData() {
  const data = await read(DATA_STORES, async (t) => {
    const out = {};
    for (const s of DATA_STORES) out[s] = await t.getAll(s);
    return out;
  });
  const payload = {
    format: FORMAT, backupVersion: CONFIG.BACKUP_VERSION, appVersion: CONFIG.APP_VERSION,
    exportedAt: new Date().toISOString(), shop: getSettings().shop.name, settings: getSettings(), data,
  };
  const name = `gasshop-backup-${localDate()}.json`;
  downloadFile(name, JSON.stringify(payload), 'application/json');
  return payload;
}

function summarize(p) {
  const counts = Object.fromEntries(DATA_STORES.filter((s) => s !== 'meta').map((s) => [s, (p.data[s] || []).length]));
  return counts;
}

function validate(p) {
  if (!p || p.format !== FORMAT || typeof p.data !== 'object') throw new Error('This file is not a GasShop backup.');
  if (num(p.backupVersion) > CONFIG.BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  for (const s of DATA_STORES) if (p.data[s] !== undefined && !Array.isArray(p.data[s])) throw new Error(`Backup section "${s}" is damaged.`);
  return true;
}

async function restore(p, mode) {
  return write(DATA_STORES, async (t) => {
    for (const s of DATA_STORES) {
      const rows = p.data[s] || [];
      if (mode === 'replace') await t.clear(s);
      for (const row of rows) if (row && (row.id !== undefined || row.key !== undefined)) await t.put(s, row);
    }
  });
}

export async function render(el, { setTitle }) {
  setTitle('Backup & Restore');
  const canExport = Auth.can('backup.export');
  const counts = await read(DATA_STORES, async (t) => {
    const out = {};
    for (const s of DATA_STORES) if (s !== 'meta') out[s] = (await t.getAll(s)).length;
    return out;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const created = await read(['meta'], (t) => t.get('meta', 'createdAt'));

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Backup & Restore', '')}
    <div class="row g-3">
      <div class="col-12 col-lg-6"><div class="card-lift p-4 h-100">
        <div class="backup-ico mb-3"><i class="bi bi-cloud-arrow-down"></i></div>
        <div class="fs-5 fw-bold">Save a backup</div>
        <p class="small text-body-secondary">Downloads every bill, purchase, customer, stock count, payment and expense to one file. Keep it on Google Drive or a USB stick. Do this regularly.</p>
        <div class="small mb-3">${total} records on this device · since ${created?.value ? fmtDateTime(created.value) : '—'}</div>
        ${canExport ? '<button class="btn btn-grad" id="bk-export"><i class="bi bi-download me-1"></i>Download backup</button>' : '<div class="small text-body-secondary">Only managers can export.</div>'}
      </div></div>
      <div class="col-12 col-lg-6"><div class="card-lift p-4 h-100">
        <div class="backup-ico tone-blue mb-3"><i class="bi bi-cloud-arrow-up"></i></div>
        <div class="fs-5 fw-bold">Restore from file</div>
        <p class="small text-body-secondary"><b>Replace</b> erases the current data on this device and loads the file. <b>Merge</b> adds the file's records and overwrites records with the same id.</p>
        ${canExport ? `<input class="form-control mb-2" type="file" accept="application/json,.json" id="bk-file">
          <div id="bk-preview" class="small"></div>
          <div class="d-flex gap-2 mt-2 d-none" id="bk-actions">
            <button class="btn btn-outline-secondary flex-fill" data-mode="merge">Merge</button>
            <button class="btn btn-danger flex-fill" data-mode="replace">Replace all</button>
          </div>` : '<div class="small text-body-secondary">Only managers can restore.</div>'}
      </div></div>
    </div>
    <div class="form-text mt-3">Passwords are never stored in the backup. Sign-in is checked against the server.</div>
  </div>`;

  const $el = window.jQuery(el);
  $el.find('#bk-export').on('click', async () => {
    try { const p = await exportData(); UI.toast(`Backup downloaded (${Object.values(summarize(p)).reduce((a, b) => a + b, 0)} records)`); } catch (e) { UI.toastError(e); }
  });

  let parsed = null;
  $el.find('#bk-file').on('change', async (e) => {
    parsed = null;
    $el.find('#bk-actions').addClass('d-none');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      validate(p);
      parsed = p;
      const c = summarize(p);
      $el.find('#bk-preview').html(`<div class="alert alert-info py-2 mb-0">
        <b>${esc(p.shop || 'Shop')}</b> · saved ${p.exportedAt ? fmtDateTime(p.exportedAt) : 'unknown date'}<br>
        ${Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'No records in this file.'}</div>`);
      $el.find('#bk-actions').removeClass('d-none');
    } catch (err) {
      $el.find('#bk-preview').html(`<div class="alert alert-danger py-2 mb-0">${esc(err.message || 'Could not read this file.')}</div>`);
    }
  });
  $el.find('[data-mode]').on('click', async (e) => {
    if (!parsed) return;
    const mode = e.currentTarget.dataset.mode;
    const ok = await UI.confirmDialog(
      mode === 'replace'
        ? 'Replace ALL data on this device with the backup file? Current bills, stock and customers will be erased first.'
        : 'Merge the backup into this device? Records with the same id will be overwritten by the file.',
      { title: mode === 'replace' ? 'Replace all data?' : 'Merge backup?', okLabel: mode === 'replace' ? 'Replace' : 'Merge', okClass: mode === 'replace' ? 'btn-danger' : 'btn-primary' });
    if (!ok) return;
    try {
      await restore(parsed, mode);
      if (parsed.settings) replaceSettings(parsed.settings);
      UI.toast('Backup restored. Reloading…');
      setTimeout(() => location.reload(), 900);
    } catch (err) { UI.toastError(err); }
  });
}
