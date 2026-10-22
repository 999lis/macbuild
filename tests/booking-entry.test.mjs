import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Colocation inquiry links carry the service into the homepage form',async()=>{
  const html=await readFile(new URL('../mac-colocation.html',import.meta.url),'utf8');
  const links=[...html.matchAll(/<a\b([^>]+)>咨询托管[\s\S]*?<\/a>/g)];
  assert.ok(links.length>=2);
  for(const [,attrs] of links) assert.match(attrs,/href="\/\?plan=colocation#order"/);
});
test('Standalone Max monthly rates explicitly include the official subscription',async()=>{
  const html=await readFile(new URL('../claude-max.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/不含 Anthropic 官方订阅费/);
  assert.match(html,/¥800\s*\/\s*月/);
  assert.match(html,/¥2,150\s*\/\s*月/);
  assert.match(html,/包含官方订阅费/);
});
