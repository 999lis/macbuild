/**
 * /api/admin/devices — 机位管理接口
 *
 * GET  /api/admin/devices                列出全部机位
 * POST /api/admin/devices                更新机位
 *      body: { code, status?, promoEligible?, price?, note? }
 *
 * 鉴权：Authorization: Bearer <ADMIN_TOKEN>
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

const VALID_STATUS = ['available', 'reserved', 'rented', 'maintenance'];

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

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const { results } = await env.DB.prepare(
    `SELECT code, status, promo_eligible, spec, location, network, ip_type, price, note, sort_order, updated_at
       FROM devices ORDER BY sort_order ASC, code ASC`
  ).all();

  return json({
    ok: true,
    devices: (results || []).map(r => ({
      code: r.code,
      status: r.status,
      promoEligible: !!r.promo_eligible,
      spec: r.spec,
      location: r.location,
      network: r.network,
      ipType: r.ip_type,
      price: r.price,
      note: r.note,
      updatedAt: r.updated_at,
    })),
  });
}

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const code = String(body.code || '').trim();
  if (!/^MY-\d{2}$/.test(code)) return json({ error: 'invalid code' }, 400);

  const sets = [];
  const params = [];

  if (body.status !== undefined) {
    const s = String(body.status);
    if (!VALID_STATUS.includes(s)) return json({ error: 'invalid status' }, 400);
    sets.push('status = ?'); params.push(s);
  }
  if (body.promoEligible !== undefined) {
    sets.push('promo_eligible = ?'); params.push(body.promoEligible ? 1 : 0);
  }
  if (body.price !== undefined) {
    const p = Number(body.price);
    if (!Number.isInteger(p) || p < 0 || p > 100000) return json({ error: 'invalid price' }, 400);
    sets.push('price = ?'); params.push(p);
  }
  if (body.note !== undefined) {
    sets.push('note = ?'); params.push(String(body.note).slice(0, 500));
  }

  if (!sets.length) return json({ error: 'nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(code);

  const res = await env.DB.prepare(
    `UPDATE devices SET ${sets.join(', ')} WHERE code = ?`
  ).bind(...params).run();

  if (!res.success) return json({ error: 'update failed' }, 500);

  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (action, device_id, detail) VALUES (?, ?, ?)`
    ).bind('update_device', code, JSON.stringify(body)).run();
  } catch { /* 日志失败不阻塞 */ }

  const after = await env.DB.prepare(
    `SELECT code, status, promo_eligible, price, note FROM devices WHERE code = ?`
  ).bind(code).first();

  return json({ ok: true, device: after });
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') return onRequestGet({ request, env });
  if (request.method === 'POST') return onRequestPost({ request, env });
  return json({ error: 'Method Not Allowed' }, 405);
}
