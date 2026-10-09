// IndexedDB schema definition and migrations.
import { CONFIG } from '../config.js';

// A separate database for the gas shop. Data from the earlier POS builds (disterp_pos) is left untouched.
export const DB_NAME = `${CONFIG.APP_ID}_gas`;
export const DB_VERSION = 1;

// Stores that make up the business data (included in backups).
export const DATA_STORES = [
  'customers', 'suppliers', 'items', 'cylStock', 'movements', 'bills', 'purchases',
  'payments', 'expenses', 'auditLog', 'meta',
];

// meta holds: schemaVersion, createdAt, gasKg (bulk gas in the tank), counter:<name> (document numbers).
// cylStock: one row per cylinder type id, { id, full, empty } = cylinders of the shop (not customers' own).
const STORES = {
  meta: { keyPath: 'key', indexes: {} },
  customers: { indexes: { nameLc: 'nameLc', phone: 'phone' } },
  suppliers: { indexes: { nameLc: 'nameLc', phone: 'phone' } },
  items: { indexes: { nameLc: 'nameLc', barcode: 'barcode', category: 'category' } },
  cylStock: { keyPath: 'id', indexes: {} },
  movements: { indexes: { at: 'at', date: 'date', refId: 'refId' } },
  bills: { indexes: { number: ['number', true], date: 'date', customerId: 'customerId', status: 'status' } },
  purchases: { indexes: { number: ['number', true], date: 'date', supplierId: 'supplierId', status: 'status' } },
  payments: { indexes: { date: 'date', partyId: 'partyId' } },
  expenses: { indexes: { date: 'date', category: 'category' } },
  auditLog: { indexes: { at: 'at' } },
};

export function upgrade(db, oldVersion, t) {
  if (oldVersion < 1) {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.createObjectStore(name, { keyPath: def.keyPath || 'id' });
      for (const [idx, spec] of Object.entries(def.indexes)) {
        const [keyPath, unique] = Array.isArray(spec) ? spec : [spec, false];
        os.createIndex(idx, keyPath, { unique: !!unique });
      }
    }
    t.objectStore('meta').put({ key: 'schemaVersion', value: 1 });
    t.objectStore('meta').put({ key: 'createdAt', value: new Date().toISOString() });
    t.objectStore('meta').put({ key: 'gasKg', value: 0 });
  }
  // Future migrations: if (oldVersion < 2) { ... }
}
