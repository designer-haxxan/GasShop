// Settings: shop profile, gas pricing, cylinder types, expense categories, receipt and theme preferences.
import { esc, num, round2 } from '../core/utils.js';
import { getSettings, saveSettings, applyTheme, DEFAULT_EXPENSE_CATEGORIES } from '../core/settings.js';
import { pageHeader } from '../core/ui.js';
import * as UI from '../core/ui.js';
import * as Auth from '../services/auth.js';

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function typeRow(t, i) {
  return `<div class="type-row" data-row>
    <input class="form-control" name="name" value="${esc(t.name)}" placeholder="e.g. Domestic 11.8 kg" aria-label="Cylinder name">
    <input class="form-control" name="kg" type="number" min="0" step="0.1" inputmode="decimal" value="${t.kg}" aria-label="Kilograms">
    <input class="form-control" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${t.price}" aria-label="Swap price">
    <button type="button" class="btn btn-light" data-rm-type aria-label="Remove type"><i class="bi bi-trash"></i></button>
    <input type="hidden" name="id" value="${esc(t.id)}">
  </div>`;
}

export async function render(el, { setTitle }) {
  setTitle('Settings');
  const s = getSettings();
  const can = Auth.can('settings.manage');
  const dis = can ? '' : 'disabled';

  el.innerHTML = `
  <div class="anim-rise">
    ${pageHeader('Settings', can ? '<button class="btn btn-grad btn-sm" id="st-save"><i class="bi bi-check2 me-1"></i>Save</button>' : '')}
    ${can ? '' : '<div class="alert alert-info small">Only the owner or a manager can change shop settings. You can still change the theme and receipt preference.</div>'}
    <form id="st-form" novalidate autocomplete="off">
      <section class="card-lift p-3 mb-3">
        <div class="section-title mt-0"><i class="bi bi-shop"></i> Shop profile</div>
        <div class="row g-2">
          <div class="col-12 col-md-6"><label class="form-label">Shop name</label><input class="form-control" name="shop.name" value="${esc(s.shop.name)}" ${dis} required></div>
          <div class="col-12 col-md-6"><label class="form-label">Tagline</label><input class="form-control" name="shop.tagline" value="${esc(s.shop.tagline)}" ${dis}></div>
          <div class="col-12 col-md-6"><label class="form-label">Phone</label><input class="form-control" name="shop.phone" inputmode="tel" value="${esc(s.shop.phone)}" ${dis}></div>
          <div class="col-12 col-md-6"><label class="form-label">License no.</label><input class="form-control" name="shop.license" value="${esc(s.shop.license)}" ${dis}></div>
          <div class="col-12"><label class="form-label">Address</label><input class="form-control" name="shop.address" value="${esc(s.shop.address)}" ${dis}></div>
          <div class="col-12"><label class="form-label">Receipt footer</label><input class="form-control" name="shop.footer" value="${esc(s.shop.footer)}" maxlength="200" ${dis}></div>
        </div>
      </section>

      <section class="card-lift p-3 mb-3">
        <div class="section-title mt-0"><i class="bi bi-fire"></i> Gas pricing</div>
        <div class="row g-2">
          <div class="col-6 col-md-3"><label class="form-label">Currency</label><input class="form-control" name="currency" value="${esc(s.currency)}" maxlength="6" ${dis}></div>
          <div class="col-6 col-md-3"><label class="form-label">Refill price per kg</label><input class="form-control" name="gasRate" type="number" min="0" step="0.01" inputmode="decimal" value="${s.gasRate}" ${dis}></div>
          <div class="col-6 col-md-3"><label class="form-label">Tank capacity (kg)</label><input class="form-control" name="tankCapacityKg" type="number" min="1" step="1" inputmode="decimal" value="${s.tankCapacityKg}" ${dis}></div>
          <div class="col-6 col-md-3"><label class="form-label">Bill prefix</label><input class="form-control" name="prefixes.bill" value="${esc(s.prefixes.bill)}" maxlength="8" ${dis}></div>
        </div>
      </section>

      <section class="card-lift p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center mt-0 mb-2">
          <div class="section-title mt-0"><i class="bi bi-circle-half"></i> Cylinder types</div>
          ${can ? '<button type="button" class="btn btn-light btn-sm" id="st-add-type"><i class="bi bi-plus-lg me-1"></i>Add type</button>' : ''}
        </div>
        <div class="type-head small text-body-secondary"><span>Name</span><span>Kg</span><span>Swap price</span><span></span></div>
        <div id="st-types">${s.cylinderTypes.map(typeRow).join('')}</div>
        <div class="form-text">Swap price = what the customer pays for one full cylinder you hand over. Changing a type does not change old bills.</div>
      </section>

      <section class="card-lift p-3 mb-3">
        <div class="section-title mt-0"><i class="bi bi-tags"></i> Expense categories</div>
        <textarea class="form-control" name="expenseCategories" rows="3" ${dis}>${esc(s.expenseCategories.join(', '))}</textarea>
        <div class="form-text">Separate categories with commas. <a href="#" data-reset-cats>Reset to defaults</a></div>
      </section>

      <section class="card-lift p-3 mb-3">
        <div class="section-title mt-0"><i class="bi bi-sliders"></i> This device</div>
        <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" role="switch" id="st-autoprint" name="autoPrint" ${s.autoPrint ? 'checked' : ''}>
          <label class="form-check-label" for="st-autoprint">Print receipt automatically after each sale</label></div>
        <label class="form-label">Theme</label>
        <div class="btn-group w-100" role="group" aria-label="Theme">
          ${[['auto', 'Auto', 'circle-half'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon-stars']].map(([v, l, i]) =>
            `<input type="radio" class="btn-check" name="theme" id="th-${v}" value="${v}" ${s.theme === v ? 'checked' : ''}>
             <label class="btn btn-outline-secondary" for="th-${v}"><i class="bi bi-${i} me-1"></i>${l}</label>`).join('')}
        </div>
      </section>
    </form>
  </div>`;

  const $el = window.jQuery(el);
  $el.on('click', '#st-add-type', () => {
    $el.find('#st-types').append(typeRow({ id: newId(), name: '', kg: 0, price: 0 }));
  });
  $el.on('click', '[data-rm-type]', (e) => {
    if ($el.find('[data-row]').length <= 1) return UI.toast('Keep at least one cylinder type.', 'warning');
    window.jQuery(e.currentTarget).closest('[data-row]').remove();
  });
  $el.on('click', '[data-reset-cats]', (e) => {
    e.preventDefault();
    $el.find('[name=expenseCategories]').val(DEFAULT_EXPENSE_CATEGORIES.join(', '));
  });
  $el.on('change', '[name=theme]', (e) => { saveSettings({ theme: e.target.value }); applyTheme(); });
  $el.on('change', '#st-autoprint', (e) => saveSettings({ autoPrint: e.target.checked }));

  $el.on('click', '#st-save', () => save(el));
}

function save(el) {
  const $el = window.jQuery(el);
  try {
    const get = (n) => $el.find(`[name="${n}"]`).val();
    const types = [];
    $el.find('[data-row]').each(function () {
      const row = window.jQuery(this);
      const name = String(row.find('[name=name]').val() || '').trim();
      const kg = round2(num(row.find('[name=kg]').val()));
      if (!name) throw new Error('Every cylinder type needs a name.');
      if (kg <= 0) throw new Error(`Enter the kilograms for ${name}.`);
      types.push({ id: row.find('[name=id]').val(), name, kg, price: round2(Math.max(0, num(row.find('[name=price]').val()))) });
    });
    if (!types.length) throw new Error('Add at least one cylinder type.');
    const shopName = String(get('shop.name') || '').trim();
    if (!shopName) throw new Error('Enter the shop name.');
    const cats = String(get('expenseCategories') || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!cats.length) throw new Error('Add at least one expense category.');

    const patch = {
      shop: {
        name: shopName, tagline: get('shop.tagline') || '', phone: get('shop.phone') || '',
        license: get('shop.license') || '', address: get('shop.address') || '', footer: get('shop.footer') || '',
      },
      currency: String(get('currency') || 'Rs').trim() || 'Rs',
      gasRate: round2(Math.max(0, num(get('gasRate')))),
      tankCapacityKg: Math.max(1, num(get('tankCapacityKg'), 1000)),
      prefixes: { bill: String(get('prefixes.bill') || 'GS').trim() || 'GS', purchase: getSettings().prefixes.purchase },
      cylinderTypes: types,
      expenseCategories: cats,
    };
    saveSettings(patch);
    UI.toast('Settings saved');
  } catch (e) { UI.toastError(e); }
}
