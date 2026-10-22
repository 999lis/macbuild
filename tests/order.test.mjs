import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../functions/api/order.js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const fixtures = JSON.parse(await readFile(new URL('./fixtures/orders.json', import.meta.url), 'utf8'));
const env = { RESEND_API_KEY: 'local-fixture-key', NOTIFY_TO: 'fixture@example.test', NOTIFY_FROM: 'Fixture <fixture@example.test>' };
for (const fixture of fixtures) {
  test('Inquiry reaches the provider payload: ' + fixture['来源'], async t => {
    const calls=[];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      calls.push(JSON.parse(options.body));
      return Response.json({id:'fixture-only'});
    });
    const body=new FormData();
    Object.entries(fixture).forEach(([key,value])=>body.set(key,value));
    const result=await onRequest({request:new Request('http://localhost/api/order',{method:'POST',body}),env});
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{ok:true});
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0].to,['fixture@example.test']);
    if(fixture['周期']) assert.ok(calls[0].text.includes(fixture['周期']));
    assert.ok(calls[0].text.includes(fixture['留言']));
    assert.ok(calls[0].text.includes(fixture['联系方式']));
  });
}
