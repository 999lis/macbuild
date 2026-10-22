import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionFromSearch,parseInventory,inventoryStats,getQuote} from '../booking.mjs';
const fixture={updatedAt:'2026-10-22',machines:[
  {id:'MY-01',status:'available',promoEligible:true},
  {id:'MY-02',status:'available',promoEligible:false},
  {id:'MY-03',status:'rented',promoEligible:true}
]};
test('Cross-page service selections quote the intended service without rental charges',()=>{
  for(const [plan,amount] of [['colocation',300],['assist5x',800],['assist20x',2150]]) {
    const selection=selectionFromSearch('?plan='+plan+'&cycle=y&line=dedicated');
    const quote=getQuote(selection,null);
    assert.equal(quote.amount,amount);
    assert.equal(selection.cycle,'m');
    assert.equal(quote.summary.includes('独立'),false);
    assert.equal(quote.summary.includes('首月'),false);
    assert.ok(quote.summary.length<=60);
  }
});
test('Machine benefit is preserved as used after the device is returned',()=>{
  assert.deepEqual(inventoryStats(parseInventory(fixture)),{total:3,available:2,promotional:1,updatedAt:'2026-10-22'});
  assert.equal(getQuote({machine:'MY-01'},fixture).amount,699);
  assert.equal(getQuote({machine:'MY-02'},fixture).amount,799);
  assert.equal(getQuote({machine:'MY-02',line:'dedicated',cycle:'q'},fixture).amount,2697);
  assert.equal(getQuote({machine:'MY-02',cycle:'y'},fixture).amount,7670);
});
test('Used, reserved or unavailable devices cannot produce an available promotional quote',()=>{
  assert.equal(getQuote({machine:'MY-03'},fixture).amount,null);
  const unavailable={...fixture,machines:fixture.machines.map(m=>({...m,status:'rented'}))};
  assert.equal(getQuote({},unavailable).kind,'unavailable');
  assert.equal(getQuote({},unavailable).amount,null);
  assert.equal(getQuote({},null).amount,null);
});
test('Exhausted benefits use normal rates across both lines and all terms',()=>{
  const data={...fixture,machines:fixture.machines.map(m=>({...m,promoEligible:false}))};
  for(const [line,totals] of [['shared',[799,2157,4075,7670]],['dedicated',[999,2697,5095,9590]]]) {
    ['m','q','h','y'].forEach((cycle,i)=>assert.equal(getQuote({line,cycle},data).amount,totals[i]));
  }
});
test('Original eight promotional prices stay intact',()=>{
  for(const [line,totals] of [['shared',[699,1887,3565,6710]],['dedicated',[899,2427,4585,8630]]]) {
    ['m','q','h','y'].forEach((cycle,i)=>assert.equal(getQuote({line,cycle,machine:'MY-01'},fixture).amount,totals[i]));
  }
});
test('Invalid records fail instead of being presented as available machines',()=>{
  assert.throws(()=>parseInventory({...fixture,machines:[fixture.machines[0],fixture.machines[0]]}));
  assert.throws(()=>parseInventory({...fixture,machines:[{...fixture.machines[0],status:'unknown'}]}));
  assert.throws(()=>parseInventory({...fixture,machines:[{...fixture.machines[0],promoEligible:'yes'}]}));
});
