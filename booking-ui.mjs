import {P,plans,machineStates,money,needsMachine,parseInventory,selectionFromSearch,normalizeSelection,inventoryStats,getQuote} from './booking.mjs?v=20261022service2';

const $=id=>document.getElementById(id);
const form=$('orderForm');
let inventory=null;
let state=selectionFromSearch(location.search);
let rental={plan:'rental',line:'shared',cycle:'m',machine:''};
const entryHash=location.hash;
let entryInteracted=false;
const entryEvents=new AbortController();
for(const type of ['wheel','touchstart','pointerdown','keydown']) {
  window.addEventListener(type,()=>{entryInteracted=true;},{passive:true,signal:entryEvents.signal});
}
const setText=(id,text)=>{const el=$(id);if(el)el.textContent=text;};

function renderRental() {
  const quote=getQuote(rental,inventory);
  document.querySelectorAll('[data-rental-line]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rentalLine===rental.line)));
  document.querySelectorAll('[data-rental-cycle]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rentalCycle===rental.cycle)));
  setText('rental-line-help',rental.line==='dedicated'?'一台机器独享出口；开通前需确认当期线路容量。':'多台机器共用出口，适合对出口 IP 无独享要求的构建与 CI。');
  setText('rental-pay-label',quote.kind!=='quoted'?'机位状态待确认':rental.cycle==='m'?'月付费用':'本周期一次付清');
  setText('rental-total',quote.amount===null?'咨询报价':money(quote.amount));
  setText('rental-unit',quote.amount===null?'':'/ '+quote.unit+' / 台');
  setText('rental-promo','以所选机位为准');
  setText('rental-detail',quote.detail);
  // Quoted availability and machine-specific prices are not copied into static search markup.
}
function syncForm() {
  state=normalizeSelection(state);
  const quote=getQuote(state,inventory);
  $('f-plan').value=state.plan;
  $('line-field').hidden=!needsMachine(state.plan);
  $('f-line').disabled=!needsMachine(state.plan);
  $('f-line').value=state.line;
  $('machine-field').hidden=!needsMachine(state.plan);
  $('f-machine').disabled=!needsMachine(state.plan);
  $('f-machine').value=state.machine;
  const account=state.plan.startsWith('assist');
  setText('qty-label',account?'需要几个账号':'需要几台');
  for(const option of $('f-qty').options) {
    const n=option.dataset.quantity;
    const quantity=n==='5plus'?'5'+(account?' 个账号以上':' 台以上'):n+(account?' 个账号':' 台');
    option.textContent=n==='unsure'?'还没确定，先咨询':quantity;
    option.value=n==='unsure'?'还没确定':quantity;
  }
  for(const option of $('f-cycle').options) {
    const c=option.dataset.period;
    option.hidden=option.disabled=state.plan!=='rental' && c!=='m';
    option.value=c;
    option.textContent=state.plan==='unsure'?'待确认':P.cycle[c];
  }
  $('f-cycle').value=state.cycle;
  $('inquiry-selection').value=quote.summary;
  setText('order-selection',quote.summary);
  const stats=inventoryStats(inventory);
  const multi=$('f-qty').value!=='1 台' && !account && needsMachine(state.plan);
  setText('order-renewal',quote.detail+(multi?' 多台申请按实际分配机位分别计算。':'')+(stats && needsMachine(state.plan)?' 库存记录更新：'+stats.updatedAt+'。':''));
  form.dataset.bookingSummary=quote.summary;
  if(state.plan==='rental'){rental={...state};renderRental();}
}
function renderInventory() {
  const stats=inventoryStats(inventory);
  setText('fleet-total',stats?stats.total:'待确认');
  setText('fleet-available',stats?stats.available:'待确认');
  setText('fleet-promotional',stats?stats.rented:'待确认');
  setText('fleet-updated',stats?'库存记录更新：'+stats.updatedAt+' · 实际交付以客服确认为准':'库存信息暂时无法加载，请联系确认机位。');
  $('f-machine').replaceChildren(new Option('按可用机位分配',''));
  $('fleet-list').replaceChildren();
  for(const machine of inventory?.machines||[]) {
    const article=document.createElement('article');article.className='machine';article.dataset.code=machine.id;article.dataset.state=machine.status;
    const image=document.createElement('img');image.src='/mac-mini-m4.webp';image.alt='';image.width=1000;image.height=717;image.loading='lazy';image.decoding='async';
    const body=document.createElement('div');body.className='machine-body';
    const heading=document.createElement('div');heading.className='machine-heading';
    const title=document.createElement('h3');title.textContent=machine.id;
    const status=document.createElement('span');status.className='machine-state';status.textContent=machineStates[machine.status];
    heading.append(title,status);
    const benefit=document.createElement('p');benefit.className='machine-benefit';benefit.textContent='M4 · 16GB / 256GB';
    body.append(heading,benefit);
    if(machine.status==='available') {
      const link=document.createElement('a');link.className='m-rent';link.href='/?plan=rental&machine='+machine.id+'#order';link.dataset.bookMachine=machine.id;link.setAttribute('aria-label','预约 '+machine.id);link.textContent='预约这台 ↗';body.append(link);
    } else {
      const note=document.createElement('span');note.className='machine-unavailable';note.textContent='暂不可预约';body.append(note);
    }
    article.append(image,body);$('fleet-list').append(article);
    const option=new Option(machine.id+' · '+machineStates[machine.status],machine.id);
    option.disabled=machine.status!=='available';$('f-machine').append(option);
  }
  if(state.machine && !inventory?.machines.some(m=>m.id===state.machine))$('f-machine').append(new Option(state.machine+' · 待确认',state.machine));
  setText('hero-rent-price',stats?.available?`${money(P.origShared)} / 月`:'租赁报价待确认');
  setText('hero-rent-promo','');
}
document.querySelectorAll('[data-rental-line]').forEach(b=>b.addEventListener('click',()=>{state={...rental,line:b.dataset.rentalLine};syncForm();}));
document.querySelectorAll('[data-rental-cycle]').forEach(b=>b.addEventListener('click',()=>{state={...rental,cycle:b.dataset.rentalCycle};syncForm();}));
document.querySelectorAll('[data-select-plan]').forEach(a=>a.addEventListener('click',()=>{state=a.dataset.selectPlan==='rental'?{...rental}:normalizeSelection({plan:a.dataset.selectPlan});syncForm();}));
$('f-plan').addEventListener('change',()=>{state=normalizeSelection({...state,plan:$('f-plan').value,machine:''});syncForm();});
$('f-line').addEventListener('change',()=>{state.line=$('f-line').value;syncForm();});
$('f-cycle').addEventListener('change',()=>{state.cycle=$('f-cycle').value;syncForm();});
$('f-machine').addEventListener('change',()=>{state.machine=$('f-machine').value;if(state.machine)$('f-qty').selectedIndex=0;syncForm();});
$('f-qty').addEventListener('change',()=>{if($('f-qty').selectedIndex!==0)state.machine='';syncForm();});
$('fleet-list').addEventListener('click',e=>{
  const link=e.target.closest('[data-book-machine]');if(!link)return;
  e.preventDefault();state=normalizeSelection({...rental,machine:link.dataset.bookMachine});$('f-qty').selectedIndex=0;syncForm();
  document.dispatchEvent(new CustomEvent('open-booking-contact'));
});
form.addEventListener('reset',()=>queueMicrotask(()=>{state=selectionFromSearch(location.search);syncForm();}));
renderInventory();syncForm();renderRental();
try {
  // 优先读 D1 实时库存；失败则回退到静态 inventory.json（保证页面不会白屏）
  let data = null;
  try {
    const live = await fetch('/api/devices', { cache: 'no-store' });
    if (live.ok) data = await live.json();
  } catch { /* 忽略，走回退 */ }
  if (!data || !Array.isArray(data.machines)) {
    const response = await fetch('/inventory.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Inventory unavailable');
    data = await response.json();
  }
  inventory = parseInventory(data);
} catch { inventory = null; }
renderInventory();syncForm();renderRental();
// Loading the inventory inserts cards above the application form. Restore the
// original anchor only if the visitor has not started interacting with the page.
if(!entryInteracted && entryHash && location.hash===entryHash) {
  document.getElementById(entryHash.slice(1))?.scrollIntoView({behavior:'instant',block:'start'});
}
entryEvents.abort();
