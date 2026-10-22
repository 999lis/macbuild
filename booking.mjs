// 当前报价常量；成本估算工具的汇率等假设仍在其 PRICE 中。
export const P = Object.freeze({
  base:699, lineDelta:200, origShared:799, origDedicated:999,
  max5x:1599, max20x:2800, colocation:300, assist5x:800, assist20x:2150,
  months:{m:1,q:3,h:6,y:12}, rate:{m:1,q:.9,h:.85,y:.8},
  cycle:{m:'月付',q:'季付',h:'半年付',y:'年付'}, unit:{m:'月',q:'季',h:'半年',y:'年'}
});
export const plans = Object.freeze({rental:'仅租 Mac',max5x:'Mac + Max 5x',max20x:'Mac + Max 20x',colocation:'自有 Mac 托管',assist5x:'单独开通 Max 5x',assist20x:'单独开通 Max 20x',unsure:'还没确定'});
export const machineStates = Object.freeze({available:'可预约',reserved:'已预约',rented:'使用中',maintenance:'维护中'});
export const money = n => '¥'+n.toLocaleString('en-US');
export const needsMachine = plan => ['rental','max5x','max20x'].includes(plan);
export function parseInventory(data) {
  if(!data || !Array.isArray(data.machines) || !/^\d{4}-\d{2}-\d{2}$/.test(data.updatedAt)) throw new Error('Invalid inventory');
  const ids=new Set();
  for(const m of data.machines) {
    if(!/^MY-\d{2}$/.test(m.id) || ids.has(m.id) || !Object.hasOwn(machineStates,m.status) || typeof m.promoEligible!=='boolean') throw new Error('Invalid machine record');
    ids.add(m.id);
  }
  return data;
}
export function normalizeSelection(input={}) {
  const plan=Object.hasOwn(plans,input.plan)?input.plan:'rental';
  return {plan,line:input.line==='dedicated'?'dedicated':'shared',cycle:plan==='rental' && Object.hasOwn(P.months,input.cycle)?input.cycle:'m',machine:needsMachine(plan) && /^MY-\d{2}$/.test(input.machine||'')?input.machine:''};
}
export function selectionFromSearch(search) {
  const params=new URLSearchParams(search);
  return normalizeSelection({plan:params.get('plan'),line:params.get('line'),cycle:params.get('cycle'),machine:params.get('machine')});
}
export function inventoryStats(inventory) {
  if(!inventory)return null;
  const free=inventory.machines.filter(m=>m.status==='available');
  return {total:inventory.machines.length,available:free.length,promotional:free.filter(m=>m.promoEligible).length,updatedAt:inventory.updatedAt};
}
export function getQuote(input,inventory) {
  const s=normalizeSelection(input);
  if(s.plan==='unsure')return {amount:null,summary:'服务方案待确认',detail:'告诉我们用途，我们协助确认服务内容。',kind:'inquiry'};
  const account=s.plan.startsWith('assist');
  const quantityUnit=account?'账号':'台';
  if(!needsMachine(s.plan)) {
    const detail=account?'按月计费，包含官方订阅费与开通协助；不含 Mac 机器或线路。':'¥300/月/台，含机位、电力、网络接入与基础值守；不含硬件与账号订阅。';
    return {amount:P[s.plan],unit:'月',quantityUnit,kind:'quoted',summary:`${plans[s.plan]} · ${money(P[s.plan])}/月/${quantityUnit}`,detail};
  }
  const stats=inventoryStats(inventory);
  const selected=s.machine?inventory?.machines.find(m=>m.id===s.machine):null;
  const subject=plans[s.plan]+(s.machine?' · '+s.machine:'');
  if(!stats || (s.machine && !selected))return {amount:null,kind:'unconfirmed',summary:subject+' · 库存与报价待确认',detail:'暂时无法确认机位记录，请先咨询库存与报价。'};
  if((selected && selected.status!=='available') || (!selected && stats.available===0))return {amount:null,kind:'unavailable',summary:subject+' · 候补咨询',detail:'所选机位暂不可预约，请更换机位或咨询下一批交付时间。'};
  const promo=s.plan==='rental' && (selected?selected.promoEligible:stats.promotional>0);
  const base=s.plan==='rental'?(promo?P.base:P.origShared):P[s.plan];
  const delta=s.line==='dedicated'?P.lineDelta:0;
  const amount=s.plan==='rental'?Math.round((base+delta)*P.months[s.cycle]*P.rate[s.cycle]):base+delta;
  const unit=s.plan==='rental' && s.cycle==='m' && promo?'首月':P.unit[s.cycle];
  const detail=s.plan==='rental'
    ? s.cycle==='m' ? (promo?`福利按台计，每台一次；续租 ${money(P.origShared+delta)}/月/台。`:'该机位不适用首次福利，按常规月费计价。')
      : `本周期一次付清，折合约 ${money(Math.round(amount/P.months[s.cycle]))}/月。${promo?'本次按可用福利机位计算。':'本次按常规月费基数打折。'}`
    : '按月计费，包含所选官方 Max 订阅费、Mac 租赁与线路。';
  return {amount,unit,quantityUnit,promo,kind:'quoted',summary:`${subject} · ${s.line==='dedicated'?'独立':'共享'} · ${P.cycle[s.cycle]} · ${money(amount)}/${unit}/台`,detail};
}
