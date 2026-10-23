/**
 * GET /api/devices — 机位库存（公开）
 *
 * 返回结构与 booking.mjs 的 parseInventory() 严格一致：
 *   { updatedAt: "YYYY-MM-DD", machines: [{ id, status, promoEligible }] }
 *
 * 另外附加 counts 方便前端做汇总展示。
 * 用法上：booking-ui.mjs 会优先读这个接口，失败则回退到 /inventory.json。
 */

function json(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
    },
  });
}

const VALID_STATUS = ['available', 'reserved', 'rented', 'maintenance'];

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  try {
    const { results } = await env.DB.prepare(
      `SELECT code, status, promo_eligible, updated_at
         FROM devices
        ORDER BY sort_order ASC, code ASC`
    ).all();

    const rows = results || [];
    if (!rows.length) return json({ error: 'inventory empty' }, 503);

    const machines = rows.map(r => ({
      id: r.code,
      status: VALID_STATUS.includes(r.status) ? r.status : 'maintenance',
      promoEligible: !!r.promo_eligible,
    }));

    // updatedAt 取最近一次改动日期，格式必须是 YYYY-MM-DD
    let latest = '1970-01-01';
    for (const r of rows) {
      const d = (r.updated_at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > latest) latest = d;
    }

    const free = machines.filter(m => m.status === 'available');

    return json({
      updatedAt: latest,
      machines,
      counts: {
        total: machines.length,
        available: free.length,
        promotional: free.filter(m => m.promoEligible).length,
        rented: machines.filter(m => m.status === 'rented').length,
        maintenance: machines.filter(m => m.status === 'maintenance').length,
      },
    });
  } catch (e) {
    console.error('devices:', e);
    return json({ error: 'read failed' }, 500);
  }
}

export async function onRequest() {
  return json({ error: 'Method Not Allowed' }, 405);
}
