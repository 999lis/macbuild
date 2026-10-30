/**
 * /api/admin/migrate — 建表/升级（幂等，可反复执行）
 *
 * POST /api/admin/migrate   执行全部 DDL
 * GET  /api/admin/migrate   只报告当前表结构，不改
 *
 * 鉴权：Authorization: Bearer <ADMIN_TOKEN>
 *
 * 为什么不碰已有的 orders / device_credentials 表：
 *   那两张表是上一轮直接对远端 D1 建的，仓库里没有 migration 文件，
 *   字段未知。为了避免 ALTER 冲突，这里新建语义明确的 rental_* 表。
 */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function authed(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.ADMIN_TOKEN || !token) return false;
  if (token.length !== env.ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS customers (
     id          INTEGER PRIMARY KEY,
     name        TEXT NOT NULL,
     contact     TEXT,
     contact_type TEXT,
     note        TEXT,
     created_at  TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS rentals (
     id           INTEGER PRIMARY KEY,
     customer_id  INTEGER NOT NULL,
     device_code  TEXT NOT NULL,
     plan         TEXT NOT NULL,
     line         TEXT DEFAULT 'shared',
     cycle        TEXT NOT NULL,
     amount       INTEGER NOT NULL,
     start_date   TEXT NOT NULL,
     end_date     TEXT NOT NULL,
     status       TEXT NOT NULL DEFAULT 'active',
     paid         INTEGER NOT NULL DEFAULT 0,
     handoff_enc  TEXT,
     note         TEXT,
     created_at   TEXT DEFAULT (datetime('now')),
     updated_at   TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE INDEX IF NOT EXISTS idx_rentals_device ON rentals (device_code)`,
  `CREATE INDEX IF NOT EXISTS idx_rentals_status ON rentals (status, end_date)`,
  `CREATE INDEX IF NOT EXISTS idx_rentals_customer ON rentals (customer_id)`,
];

const TABLES = ['customers', 'rentals'];

async function report(env) {
  const out = {};
  for (const t of TABLES) {
    try {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      out[t] = { ok: true, rows: r ? r.n : 0 };
    } catch (e) {
      out[t] = { ok: false, error: String(e.message || e) };
    }
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  return json({ ok: true, mode: 'report', tables: await report(env) });
}

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const applied = [];
  const failed = [];

  for (const sql of DDL) {
    try {
      await env.DB.prepare(sql).run();
      applied.push(sql.split('\n')[0].trim().slice(0, 60));
    } catch (e) {
      failed.push({ sql: sql.split('\n')[0].trim().slice(0, 60), error: String(e.message || e) });
    }
  }

  return json({
    ok: failed.length === 0,
    applied,
    failed,
    tables: await report(env),
    credKeyConfigured: !!env.CRED_KEY,
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') return onRequestGet({ request, env });
  if (request.method === 'POST') return onRequestPost({ request, env });
  return json({ error: 'Method Not Allowed' }, 405);
}
