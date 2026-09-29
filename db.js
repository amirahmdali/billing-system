import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path = process.env.DB_PATH || './data/business.sqlite') {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('OWNER','FINANCE','STAFF','VIEWER')), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), company_name TEXT NOT NULL DEFAULT 'My Company', registration_no TEXT DEFAULT '', address TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '', bank_name TEXT DEFAULT '', bank_account TEXT DEFAULT '', bank_holder TEXT DEFAULT '', currency TEXT NOT NULL DEFAULT 'MYR', quote_terms TEXT DEFAULT '', invoice_terms TEXT DEFAULT '', purchase_order_terms TEXT DEFAULT '');
INSERT OR IGNORE INTO settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY, company_name TEXT NOT NULL, contact_name TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 30, notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sequences(type TEXT NOT NULL, year INTEGER NOT NULL, next_value INTEGER NOT NULL, PRIMARY KEY(type,year));
CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), number TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','ACCEPTED','REJECTED','CONVERTED')), issue_date TEXT NOT NULL, expiry_date TEXT, currency TEXT NOT NULL DEFAULT 'MYR', subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, notes TEXT DEFAULT '', terms TEXT DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 30, created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS quote_items(id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE, position INTEGER NOT NULL, description TEXT NOT NULL, quantity_milli INTEGER NOT NULL, unit TEXT DEFAULT '', unit_price INTEGER NOT NULL, discount_bps INTEGER NOT NULL DEFAULT 0, tax_bps INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_orders(id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), number TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','APPROVED','REJECTED')), issue_date TEXT NOT NULL, expiry_date TEXT, currency TEXT NOT NULL DEFAULT 'MYR', subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, notes TEXT DEFAULT '', terms TEXT DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 30, created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_order_items(id INTEGER PRIMARY KEY, purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, position INTEGER NOT NULL, description TEXT NOT NULL, quantity_milli INTEGER NOT NULL, unit TEXT DEFAULT '', unit_price INTEGER NOT NULL, discount_bps INTEGER NOT NULL DEFAULT 0, tax_bps INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), source_quote_id INTEGER UNIQUE REFERENCES quotes(id), number TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','PARTIALLY_PAID','PAID','VOID')), issue_date TEXT NOT NULL, due_date TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'MYR', subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, amount_paid INTEGER NOT NULL DEFAULT 0, balance_due INTEGER NOT NULL, client_name TEXT NOT NULL, client_contact TEXT DEFAULT '', client_email TEXT DEFAULT '', client_address TEXT DEFAULT '', company_snapshot TEXT NOT NULL, notes TEXT DEFAULT '', terms TEXT DEFAULT '', created_by INTEGER REFERENCES users(id), sent_at TEXT, paid_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invoice_items(id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, position INTEGER NOT NULL, description TEXT NOT NULL, quantity_milli INTEGER NOT NULL, unit TEXT DEFAULT '', unit_price INTEGER NOT NULL, discount_bps INTEGER NOT NULL DEFAULT 0, tax_bps INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), date TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), method TEXT NOT NULL, reference TEXT DEFAULT '', notes TEXT DEFAULT '', created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT DEFAULT '', vendor TEXT DEFAULT '', description TEXT DEFAULT '', amount INTEGER NOT NULL CHECK(amount>0), reference TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, details TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments(date);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);
CREATE INDEX IF NOT EXISTS invoices_due_idx ON invoices(due_date,status);
`);
  const settingsCols = db.prepare("PRAGMA table_info(settings)").all().map(c => c.name);
  if (!settingsCols.includes('purchase_order_terms')) db.exec("ALTER TABLE settings ADD COLUMN purchase_order_terms TEXT DEFAULT ''");
  const ordersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_orders'").get();
  if (!ordersTable) db.exec(`CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), number TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','APPROVED','REJECTED')), issue_date TEXT NOT NULL, expiry_date TEXT, currency TEXT NOT NULL DEFAULT 'MYR', subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, notes TEXT DEFAULT '', terms TEXT DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 30, created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const orderItemsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_order_items'").get();
  if (!orderItemsTable) db.exec(`CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY, purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, position INTEGER NOT NULL, description TEXT NOT NULL, quantity_milli INTEGER NOT NULL, unit TEXT DEFAULT '', unit_price INTEGER NOT NULL, discount_bps INTEGER NOT NULL DEFAULT 0, tax_bps INTEGER NOT NULL DEFAULT 0, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL);`);
  return db;
}
export function transaction(db, work) { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } }
export function nextNumber(db, type, year) {
  db.prepare('INSERT OR IGNORE INTO sequences(type,year,next_value) VALUES(?,?,1)').run(type,year);
  const value=db.prepare('UPDATE sequences SET next_value=next_value+1 WHERE type=? AND year=? RETURNING next_value-1 AS n').get(type,year).n;
  return `${type}-${year}-${String(value).padStart(6,'0')}`;
}
export function cents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw Error('Amount required');
  const str=String(value).trim();
  if(!/^\d{1,12}(\.\d{1,2})?$/.test(str)) throw Error('Invalid amount');
  const [a,b='']=str.split('.'); return Number(a)*100+Number(b.padEnd(2,'0'));
}
function rounded(n,d) { return Math.floor((n + d/2)/d); }
export function computeItems(items) {
  if (!Array.isArray(items) || items.length<1 || items.length>100) throw Error('Add 1 to 100 items');
  const lines=items.map((it,i)=>{
    const description=String(it.description||'').trim(); if(!description || description.length>1000) throw Error('Invalid item description');
    const qty=String(it.quantity ?? '1'); if(!/^\d{1,9}(\.\d{1,3})?$/.test(qty)) throw Error('Invalid quantity');
    const [whole,frac='']=qty.split('.'); const quantity_milli=Number(whole)*1000+Number(frac.padEnd(3,'0'));
    const unit_price=cents(it.unitPrice); const discount_bps=percentBps(it.discountPercent||0), tax_bps=percentBps(it.taxPercent||0);
    if(!quantity_milli || !unit_price) throw Error('Quantity and rate must be positive');
    const subtotal=rounded(quantity_milli*unit_price,1000), discount=rounded(subtotal*discount_bps,10000), tax=rounded((subtotal-discount)*tax_bps,10000);
    return {position:i+1,description,quantity_milli,unit:String(it.unit||'').slice(0,30),unit_price,discount_bps,tax_bps,subtotal,discount,tax,total:subtotal-discount+tax};
  });
  return {lines, subtotal:lines.reduce((n,x)=>n+x.subtotal,0),discount:lines.reduce((n,x)=>n+x.discount,0),tax:lines.reduce((n,x)=>n+x.tax,0),total:lines.reduce((n,x)=>n+x.total,0)};
}
function percentBps(value) {const s=String(value); if(!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw Error('Invalid percentage'); const [a,b='']=s.split('.'); const v=Number(a)*100+Number(b.padEnd(2,'0')); if(v>10000) throw Error('Percentage exceeds 100'); return v;}
export function datePlus(date,days) { const d=new Date(date+'T12:00:00Z'); if(Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==date || !Number.isInteger(days) || days<0 || days>3650) throw Error('Invalid date or payment terms'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
export function reconcile(db,id) {
  const inv=db.prepare('SELECT total,status FROM invoices WHERE id=?').get(id); if(!inv) throw Error('Invoice not found');
  const paid=db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE invoice_id=?').get(id).n;
  const balance=inv.total-paid;
  const status=inv.status==='VOID'?'VOID':paid===inv.total?'PAID':paid>0?'PARTIALLY_PAID':inv.status==='DRAFT'?'DRAFT':'SENT';
  db.prepare('UPDATE invoices SET amount_paid=?,balance_due=?,status=?,paid_at=CASE WHEN ?=\'PAID\' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?').run(paid,balance,status,status,id);
}
