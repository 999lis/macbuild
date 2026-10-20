/**
 * Cloudflare Pages Function — POST /api/order
 *
 * 接收下单表单，用 Resend 发通知邮件到 NOTIFY_TO。
 *
 * 需要的环境变量（Cloudflare Pages → Settings → Environment variables）：
 *   RESEND_API_KEY   必填  Resend 的 API Key（re_ 开头）
 *   NOTIFY_TO        必填  收件邮箱，多个用英文逗号分隔
 *   NOTIFY_FROM      可选  发件人，默认 onboarding@resend.dev
 *                          验证域名后建议改成 MacBuild <noreply@getmacbuild.com>
 *
 * 返回：成功 {ok:true}；失败 {errors:[{message}]}（与前端已有解析逻辑对齐）
 */

const MAX = { name: 80, contact: 120, qty: 40, cycle: 60, msg: 2000 };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

const fail = (msg, status = 400) => json({ errors: [{ message: msg }] }, status);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return json({ errors: [{ message: 'Method Not Allowed' }] }, 405);
  }
  return handleOrder(context);
}

async function handleOrder({ request, env }) {
  // ---- 环境变量检查：缺什么就直说，别静默失败 ----
  const key = env.RESEND_API_KEY;
  const to = (env.NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  const from = env.NOTIFY_FROM || 'MacBuild <onboarding@resend.dev>';

  if (!key || !to.length) {
    console.error('order: 缺少 RESEND_API_KEY 或 NOTIFY_TO');
    return fail('表单服务尚未配置完成，请直接加微信 Mondbinch 联系我们。', 503);
  }

  // ---- 解析表单 ----
  let fd;
  try {
    fd = await request.formData();
  } catch {
    return fail('提交格式不正确。');
  }

  const get = (k) => String(fd.get(k) ?? '').trim();

  // 蜜罐：填了就是机器人，假装成功
  if (get('_gotcha')) return json({ ok: true });

  const name = get('称呼').slice(0, MAX.name);
  const contact = get('联系方式').slice(0, MAX.contact);
  const qty = get('台数').slice(0, MAX.qty) || '未填';
  const cycle = get('周期').slice(0, MAX.cycle) || '未填';
  const msg = get('留言').slice(0, MAX.msg) || '（无）';
  const source = get('来源').slice(0, 60) || 'macbuild-site';

  if (!name || !contact) {
    return fail('请填写称呼和联系方式。');
  }

  // ---- 组装邮件 ----
  const rows = [
    ['称呼', name],
    ['联系方式', contact],
    ['需要几台', qty],
    ['期望周期', cycle],
    ['用途与期望时间', msg],
    ['来源', source],
  ];

  const subject = `[MacBuild] 新申请 · ${name} · ${qty}`;

  const text = rows.map(([k, v]) => `${k}：${v}`).join('\n') +
    `\n\n提交时间：${new Date().toISOString()}`;

  const html = `<!doctype html><meta charset="utf-8">
<div style="font:14px/1.7 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#1a1a18">
  <h2 style="margin:0 0 16px;font-size:17px">MacBuild 新申请</h2>
  <table style="border-collapse:collapse;width:100%;max-width:640px">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:9px 14px 9px 0;color:#6b6862;vertical-align:top;white-space:nowrap;border-bottom:1px solid #e2ddd1">${esc(k)}</td>
      <td style="padding:9px 0;vertical-align:top;border-bottom:1px solid #e2ddd1;white-space:pre-wrap">${esc(v)}</td>
    </tr>`).join('')}
  </table>
  <p style="margin:18px 0 0;font-size:12.5px;color:#6b6862">提交时间：${new Date().toISOString()}</p>
</div>`;

  // ---- 发送 ----
  const payload = { from, to, subject, text, html };
  // 如果联系方式看起来是邮箱，直接设 reply-to，回信不用复制粘贴
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) payload.reply_to = contact;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('order: Resend 返回', res.status, detail.slice(0, 500));
      // Resend 未验证域名时只允许发到账号本人邮箱，这个错最常见，单独提示
      if (res.status === 403 || /domain|not verified|testing/i.test(detail)) {
        return fail('邮件服务尚未完成域名验证，请直接加微信 Mondbinch 联系我们。', 502);
      }
      return fail('发送失败，请稍后重试，或直接加微信 Mondbinch。', 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('order: 请求 Resend 异常', err);
    return fail('网络异常，请稍后重试，或直接加微信 Mondbinch。', 502);
  }
}
