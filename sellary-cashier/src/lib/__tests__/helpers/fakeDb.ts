import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(dir, '../../../../src-tauri/migrations');

function normalize(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === 'boolean') return a ? 1 : 0;
    if (a === undefined) return null;
    return a;
  });
}

function toPositional(sql: string, params: unknown[]): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
  const converted = sql.replace(/\$(\d+)/g, (_m, d) => {
    args.push(params[Number(d) - 1]);
    return '?';
  });
  return { sql: converted, args: normalize(args) };
}

export class FakeDatabase {
  constructor(private raw: DatabaseSync) {}

  async execute(sql: string, params: unknown[] = []) {
    const { sql: s, args } = toPositional(sql, params);
    const info = this.raw.prepare(s).run(...(args as never[]));
    return { lastInsertId: Number(info.lastInsertRowid), rowsAffected: Number(info.changes) };
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const { sql: s, args } = toPositional(sql, params);
    return this.raw.prepare(s).all(...(args as never[])) as T;
  }

  seedProduct(p: { id: number; name?: string; barcode?: string | null; sell_price?: number; stock_quantity?: number; tax_percent?: number; uom?: string }) {
    this.raw.prepare(
      `INSERT INTO products (id, barcode, name, uom, category_id, sell_price, tax_percent, stock_quantity, is_active, updated_at)
       VALUES (?,?,?,?,?,?,?,?,1,'2025-01-01T00:00:00.000Z')`
    ).run(p.id, p.barcode ?? null, p.name ?? `P${p.id}`, p.uom ?? 'pcs', null, p.sell_price ?? 10, p.tax_percent ?? 0, p.stock_quantity ?? 100);
  }

  stockOf(productId: number): number {
    const row = this.raw.prepare('SELECT stock_quantity AS s FROM products WHERE id = ?').get(productId) as { s: number } | undefined;
    return row?.s ?? 0;
  }
}

export function createTestDb(): FakeDatabase {
  const raw = new DatabaseSync(':memory:');
  const sql001 = fs.readFileSync(path.join(migrationsDir, '001_init.sql'), 'utf8');
  const sql002 = fs.readFileSync(path.join(migrationsDir, '002_local_first.sql'), 'utf8');
  const sql003 = fs.readFileSync(path.join(migrationsDir, '003_offline_credit.sql'), 'utf8');
  raw.exec(sql001);
  raw.exec(sql002);
  raw.exec(sql003);
  return new FakeDatabase(raw);
}
