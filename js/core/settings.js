// Shop profile, gas pricing, cylinder types and preferences stored in LocalStorage (never operational data or secrets).
import { storageKey } from '../config.js';

const KEY = storageKey('gasshop.settings');

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Salaries', 'Transport', 'Repairs & Maintenance', 'Cylinder Testing',
  'Staff Food & Tea', 'Cleaning', 'Stationery', 'Other',
];

export const DEFAULT_SETTINGS = {
  shop: {
    name: 'My Gas Shop',
    tagline: 'Fast refills · Safe cylinders',
    address: '',
    phone: '',
    license: '',
    footer: 'Thank you for your business. Check hoses and regulators regularly.',
  },
  currency: 'Rs',
  gasRate: 0,              // price per kg of gas for refilling a customer's own cylinder
  tankCapacityKg: 1000,    // bulk gas storage capacity, used for the tank gauge
  // Cylinder types the shop sells, exchanges and refills. price = exchange price per full cylinder.
  cylinderTypes: [
    { id: 'd11', name: 'Domestic 11.8 kg', kg: 11.8, price: 0 },
    { id: 'c15', name: 'Commercial 15 kg', kg: 15, price: 0 },
    { id: 'c45', name: 'Commercial 45 kg', kg: 45, price: 0 },
  ],
  expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
  prefixes: { bill: 'GS', purchase: 'PO' },
  autoPrint: false,        // print a receipt automatically after each sale
  theme: 'auto',
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

let cache = null;
export function getSettings() {
  if (!cache) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }
    cache = merge(DEFAULT_SETTINGS, stored);
  }
  return cache;
}

export function saveSettings(patch) {
  cache = merge(getSettings(), patch);
  localStorage.setItem(KEY, JSON.stringify(cache));
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

export function replaceSettings(all) {
  cache = merge(DEFAULT_SETTINGS, all || {});
  localStorage.setItem(KEY, JSON.stringify(cache));
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

export const cylinderType = (id) => getSettings().cylinderTypes.find((t) => t.id === id) || null;

// Small per-device preference helpers
export const pref = {
  get(k, d = null) { try { const v = localStorage.getItem(storageKey('pref.' + k)); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(storageKey('pref.' + k), JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

export function applyTheme() {
  const t = getSettings().theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1120' : '#ea580c');
}
