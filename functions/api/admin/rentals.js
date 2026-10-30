/**
 * /api/admin/rentals — 客户 / 租约 / 交付信息
 *
 * GET  /api/admin/rentals                列出全部租约（含客户、剩余天数、到期预警）
 * GET  /api/admin/rentals?id=12&reveal=1 解密查看该租约的交付信息
 * POST /api/admin/rentals                新建租约（无 id）
 *                                        更新租约（有 id + 字段）
 *                                        续租（有 id + renew:true）
 *
 * 鉴权：Authorization: Bearer <ADMIN_TOKEN>
 *
 * 交付信息（RustDesk ID/密码、SSH、VNC）用 AES-GCM 加密后存 handoff_enc，
 * 明文永远不落库、不在列表接口里出现。密钥来自环境变量 CRED_KEY（base64 的 32 字节）。
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

/* ---------- 日期 ---------- */

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function fmt(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDaysStr(s, n) {
  const p = parseDate(s);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function addMonthsStr(s, n) {
  const p = parseDate(s);
  const base = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(p.d, lastDay);
  return fmt(base.getUTCFullYear(), base.getUTCMonth() + 1, day);
}

/** 起始日 + N 个月，末日按「最后一天」算（11-01 起 1 个月 → 11-30） */
function periodEnd(startStr, months) {
  return addDaysStr(addMonthsStr(startStr, months), -1);
}

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, half: 6, yearly: 12 };
const VALID_STATUS = ['active', 'expired', 'cancelled'];

function daysBetween(a, b) {
  const pa = parseDate(a), pb = parseDate(b);
  if (!pa || !pb) return null;
  const ta = Date.UTC(pa.y, pa.m - 1, pa.d);
  const tb = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((tb - ta) / 86400000);
}

/* ---------- 加密 ---------- */

async function getKey(env) {
  if (!env.CRED_KEY) return null;
  try {
    const bin = Uint8Array.from(atob(env.CRED_KEY), c => c.charCodeAt(0));
    if (bin.length !== 32) return null;
    return await crypto.subtle.importKey('raw', bin, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function unb64(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function seal(env, text) {
  const key = await getKey(env);
  if (!key) throw new Error('CRED_KEY 未配置或长度不对（需 base64 的 32 字节）');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return b64(iv) + '.' + b64(ct);
}

async function open(env, sealed) {
  const key = await getKey(env);
  if (!key) throw new Error('CRED_KEY 未配置或长度不对');
  const [ivS, ctS] = String(sealed).split('.');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(ivS) }, key, unb64(ctS)
  );
  return new TextDecoder().decode(pt);
}

/* ---------- 读 ---------- */

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  // 解密单条交付信息
  if (id) {
    const row = await env.DB.prepare(
      `SELECT id, device_code, handoff_enc FROM rentals WHERE id = ?`
    ).bind(Number(id)).first();
    if (!row) return json({ error: 'not found' }, 404);
    if (!row.handoff_enc) return json({ ok: true, handoff: '' });
    if (!env.CRED_KEY) return json({ error: 'CRED_KEY 未配置，无法解密' }, 503);
    try {
      return json({ ok: true, handoff: await open(env, row.handoff_enc) });
    } catch (e) {
      return json({ error: '解密失败：' + String(e.message || e) }, 500);
    }
  }

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.customer_id, r.device_code, r.plan, r.line, r.cycle,
            r.amount, r.start_date, r.end_date, r.status, r.paid, r.note,
            r.created_at, r.updated_at,
            (r.handoff_enc IS NOT NULL AND r.handoff_enc <> '') AS has_handoff,
            c.name AS customer_name, c.contact, c.contact_type
       FROM rentals r
       LEFT JOIN customers c ON c.id = r.customer_id
      ORDER BY r.end_date ASC, r.id ASC`
  ).all();

  const t = today();
  const list = (results || []).map(r => {
    const left = daysBetween(t, r.end_date);
    return {
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name || '—',
      contact: r.contact,
      contactType: r.contact_type,
      deviceCode: r.device_code,
      plan: r.plan,
      line: r.line,
      cycle: r.cycle,
      amount: r.amount,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      paid: !!r.paid,
      note: r.note,
      hasHandoff: !!r.has_handoff,
      daysLeft: left,
      expiringSoon: r.status === 'active' && left !== null && left >= 0 && left <= 7,
      overdue: r.status === 'active' && left !== null && left < 0,
    };
  });

  return json({
    ok: true,
    today: t,
    count: list.length,
    expiringSoon: list.filter(x => x.expiringSoon).length,
    overdue: list.filter(x => x.overdue).length,
    rentals: list,
  });
}

/* ---------- 写 ---------- */

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  /* ===== 续租 ===== */
  if (body.id && body.renew) {
    const cur = await env.DB.prepare(
      `SELECT id, cycle, end_date, status FROM rentals WHERE id = ?`
    ).bind(Number(body.id)).first();
    if (!cur) return json({ error: 'not found' }, 404);

    const months = CYCLE_MONTHS[cur.cycle] || 1;
    const base = cur.end_date;
    const nextStart = addDaysStr(base, 1);
    const nextEnd = periodEnd(nextStart, months);

    await env.DB.prepare(
      `UPDATE rentals SET end_date = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`
    ).bind(nextEnd, Number(body.id)).run();

    await audit(env, 'renew_rental', String(body.id), { from: base, to: nextEnd });
    return json({ ok: true, id: Number(body.id), endDate: nextEnd });
  }

  /* ===== 更新 ===== */
  if (body.id) {
    const sets = [], params = [];

    if (body.status !== undefined) {
      const s = String(body.status);
      if (!VALID_STATUS.includes(s)) return json({ error: 'invalid status' }, 400);
      sets.push('status = ?'); params.push(s);
    }
    if (body.paid !== undefined) { sets.push('paid = ?'); params.push(body.paid ? 1 : 0); }
    if (body.amount !== undefined) {
      const a = Number(body.amount);
      if (!Number.isInteger(a) || a < 0 || a > 1000000) return json({ error: 'invalid amount' }, 400);
      sets.push('amount = ?'); params.push(a);
    }
    if (body.endDate !== undefined) {
      if (!parseDate(body.endDate)) return json({ error: 'invalid endDate' }, 400);
      sets.push('end_date = ?'); params.push(String(body.endDate));
    }
    if (body.note !== undefined) { sets.push('note = ?'); params.push(String(body.note).slice(0, 1000)); }

    if (body.handoff !== undefined) {
      const text = String(body.handoff).slice(0, 4000);
      if (text) {
        try { sets.push('handoff_enc = ?'); params.push(await seal(env, text)); }
        catch (e) { return json({ error: String(e.message || e) }, 503); }
      } else {
        sets.push('handoff_enc = NULL');
      }
    }

    if (!sets.length) return json({ error: 'nothing to update' }, 400);
    sets.push("updated_at = datetime('now')");
    params.push(Number(body.id));

    await env.DB.prepare(`UPDATE rentals SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    await audit(env, 'update_rental', String(body.id), { keys: Object.keys(body) });

    const after = await env.DB.prepare(
      `SELECT id, device_code, status, paid, end_date FROM rentals WHERE id = ?`
    ).bind(Number(body.id)).first();
    return json({ ok: true, rental: after });
  }

  /* ===== 新建 ===== */
  const name = String(body.customerName || '').trim();
  if (!name) return json({ error: '缺少客户名称' }, 400);

  const deviceCode = String(body.deviceCode || '').trim();
  if (!/^MY-\d{2}$/.test(deviceCode)) return json({ error: 'invalid deviceCode' }, 400);

  const cycle = String(body.cycle || 'monthly');
  if (!CYCLE_MONTHS[cycle]) return json({ error: 'invalid cycle' }, 400);

  const startDate = body.startDate ? String(body.startDate) : today();
  if (!parseDate(startDate)) return json({ error: 'invalid startDate' }, 400);

  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1000000) {
    return json({ error: 'invalid amount' }, 400);
  }

  const months = Number.isInteger(body.months) && body.months > 0 && body.months <= 36
    ? body.months : CYCLE_MONTHS[cycle];
  const endDate = periodEnd(startDate, months);

  // 同一台机器不允许两条 active 租约
  const conflict = await env.DB.prepare(
    `SELECT id FROM rentals WHERE device_code = ? AND status = 'active'`
  ).bind(deviceCode).first();
  if (conflict) return json({ error: `${deviceCode} 已有生效中的租约（#${conflict.id}）` }, 409);

  // 客户：按联系方式或名称复用
  const contact = String(body.contact || '').trim().slice(0, 200);
  let customerId = null;
  if (contact) {
    const found = await env.DB.prepare(`SELECT id FROM customers WHERE contact = ?`).bind(contact).first();
    if (found) customerId = found.id;
  }
  if (!customerId) {
    const found = !contact
      ? await env.DB.prepare(`SELECT id FROM customers WHERE name = ?`).bind(name).first()
      : null;
    if (found) customerId = found.id;
  }
  if (!customerId) {
    const ins = await env.DB.prepare(
      `INSERT INTO customers (name, contact, contact_type, note) VALUES (?, ?, ?, ?)`
    ).bind(name, contact, String(body.contactType || ''), String(body.note || '').slice(0, 500)).run();
    customerId = ins.meta && ins.meta.last_row_id;
    if (!customerId) {
      const back = await env.DB.prepare(`SELECT id FROM customers ORDER BY id DESC LIMIT 1`).first();
      customerId = back && back.id;
    }
  }

  let handoffEnc = null;
  if (body.handoff) {
    try { handoffEnc = await seal(env, String(body.handoff).slice(0, 4000)); }
    catch (e) { return json({ error: String(e.message || e) }, 503); }
  }

  const ins = await env.DB.prepare(
    `INSERT INTO rentals
       (customer_id, device_code, plan, line, cycle, amount, start_date, end_date, status, paid, handoff_enc, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(
    customerId, deviceCode, String(body.plan || 'mac'), String(body.line || 'shared'),
    cycle, amount, startDate, endDate, body.paid ? 1 : 0, handoffEnc,
    String(body.note || '').slice(0, 1000)
  ).run();

  const rentalId = (ins.meta && ins.meta.last_row_id) || null;

  // 同步机位状态
  const devStatus = startDate > today() ? 'reserved' : 'rented';
  try {
    await env.DB.prepare(
      `UPDATE devices SET status = ?, updated_at = datetime('now') WHERE code = ?`
    ).bind(devStatus, deviceCode).run();
  } catch { /* devices 表不存在时忽略 */ }

  // 消耗「前 10 台福利」
  if (body.consumePromo) {
    try {
      await env.DB.prepare(
        `UPDATE devices SET promo_eligible = 0, updated_at = datetime('now') WHERE code = ?`
      ).bind(deviceCode).run();
    } catch { /* 忽略 */ }
  }

  await audit(env, 'create_rental', String(rentalId), {
    deviceCode, cycle, amount, endDate, customerId
  });

  return json({
    ok: true,
    id: rentalId,
    customerId,
    endDate,
    deviceStatus: devStatus,
  });
}

async function audit(env, action, target, detail) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (action, device_id, detail) VALUES (?, ?, ?)`
    ).bind(action, target, JSON.stringify(detail || {})).run();
  } catch { /* 日志失败不阻塞 */ }
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') return onRequestGet({ request, env });
  if (request.method === 'POST') return onRequestPost({ request, env });
  return json({ error: 'Method Not Allowed' }, 405);
}
