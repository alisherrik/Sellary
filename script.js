'use strict';
const isRussian = document.documentElement.lang === 'ru';
const t = text => (window.SELLARY_TRANSLATIONS || {})[text]
  || (isRussian && /^[\d,.]+ TJS$/.test(text) ? text.replace(/,/g, ' ').replace('.', ',') : text);
const format = (text, values) => t(text).replace(/\{(\w+)\}/g, (_, key) => values[key]);
const itemCount = count => isRussian
  ? count+' '+({one:'товар',few:'товара',many:'товаров',other:'товара'}[new Intl.PluralRules('ru').select(count)])
  : count+' '+(count===1?'item':'items');
const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-'+name+'"/></svg>';
const productArt = [
'<path d="m22 13 8-8h20l8 8v59H22Z" fill="#f5f8ff" stroke="#abbcd4" stroke-width="1.5"/><path d="M22 13h36M30 5v8" stroke="#abbcd4" stroke-width="1.5"/><path d="M22 32h36v24H22Z" fill="#2563eb"/><path d="M30 40h20m-17 5h14m-11 5h8" stroke="white" stroke-width="2"/><circle cx="48" cy="21" r="4" fill="#e0e9f7"/>',
'<path d="M20 11h40l-3 13 5 46H18l5-46Z" fill="#f0e5ce" stroke="#b9ab8e" stroke-width="1.5"/><path d="M21 13h38M20 64h40" stroke="#b9ab8e"/><rect x="26" y="30" width="28" height="22" rx="3" fill="#657b57"/><path d="M34 40h12m-9 5h6" stroke="white" stroke-width="2"/><path d="m35 21 2 3m7-3-2 3" stroke="#b7a680" stroke-width="2"/>',
'<path d="M33 5h14v12l7 10v45H26V27l7-10Z" fill="#eddda6" stroke="#b2a073" stroke-width="1.5"/><path d="M32 5h16v7H32Z" fill="#526243"/><rect x="27" y="37" width="26" height="19" fill="#f8f6ee"/><path d="M34 43h12m-10 5h8" stroke="#526243" stroke-width="2"/>',
'<path d="M13 44c0-15 12-25 27-25s27 10 27 25v15H13Z" fill="#d9b586" stroke="#af8c5d" stroke-width="1.5"/><path d="m26 27-5 12m21-15-5 14m20-8-5 12" stroke="#f2d2a5" stroke-width="4" stroke-linecap="round"/><path d="M15 52h50" stroke="#ba965f"/>',
'<path d="m13 32 6-10h42l6 10-4 29H17Z" fill="#d4c5ab" stroke="#b2a28b" stroke-width="1.5"/><ellipse cx="28" cy="33" rx="9" ry="12" fill="#f5e8d3"/><ellipse cx="51" cy="33" rx="9" ry="12" fill="#efe1cb"/><path d="M14 40h52l-3 21H17Z" fill="#cbb99a" stroke="#b2a28b"/><path d="M27 47h26v8H27Z" fill="#f3eddf"/>',
'<rect x="20" y="12" width="40" height="58" rx="2" fill="#3d6757" stroke="#2e5244" stroke-width="1.5"/><rect x="26" y="25" width="28" height="29" rx="2" fill="#f1e9d9"/><path d="M34 35h12m-10 5h8m-6 5h4" stroke="#3d6757" stroke-width="2"/><path d="M23 17h34m-34 47h34" stroke="#658774"/>'
];
const products = [
{id:0,name:'Fresh milk',price:1200,unit:'1 L'},
{id:1,name:'Basmati rice',price:2800,unit:'1 kg'},
{id:2,name:'Sunflower oil',price:3800,unit:'1 L'},
{id:3,name:'Fresh bread',price:1000,unit:'1 loaf'},
{id:4,name:'Farm eggs',price:1800,unit:'6 pcs'},
{id:5,name:'Green tea',price:2400,unit:'100 g'}
];
const art = index => '<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">'+productArt[index]+'</svg>';
const money = cents => (cents/100).toFixed(2).replace('.', isRussian ? ',' : '.');
let cart = new Map([[0,1],[1,1],[3,1]]);
const productsNode = document.getElementById('hero-products');
productsNode.innerHTML=products.map(p=>'<button class="product-tile" data-product="'+p.id+'" aria-label="'+format('Add {name} to demo sale, {price} TJS',{name:t(p.name),price:money(p.price)})+'"><span class="product-picture">'+art(p.id)+'</span><span class="product-name">'+t(p.name)+'</span><span class="product-price">'+money(p.price)+' <span class="product-add" aria-hidden="true">+</span></span></button>').join('');
document.getElementById('phone-products').innerHTML=[0,1,3,5].map(id=>{const p=products[id];return '<div class="phone-product"><div class="product-picture">'+art(p.id)+'</div><strong>'+t(p.name)+'</strong><span>'+money(p.price)+' TJS <span class="plus" aria-hidden="true">+</span></span></div>';}).join('');
function renderCart(){
let total=0,count=0;
document.getElementById('receipt-lines').innerHTML=Array.from(cart).map(([id,qty])=>{const p=products[id];total+=p.price*qty;count+=qty;return '<div class="receipt-line"><span>'+t(p.name)+'<small>'+qty+' × '+money(p.price)+'</small></span><strong>'+money(p.price*qty)+'</strong></div>';}).join('');
document.getElementById('item-count').textContent=itemCount(count);
document.getElementById('cart-total').textContent=money(total);
document.getElementById('subtotal').textContent=money(total);
const pay=document.getElementById('demo-pay');pay.disabled=count===0;
pay.innerHTML=count?t('Complete sale')+' '+icon('arrow'):t('Add products to begin');
return total;
}
productsNode.addEventListener('click',e=>{const btn=e.target.closest('[data-product]');if(!btn)return;const id=Number(btn.dataset.product);cart.set(id,(cart.get(id)||0)+1);renderCart();document.querySelector('#receipt-toast strong').textContent=format('{name} added.',{name:t(products[id].name)});document.querySelector('#receipt-toast div>span').textContent=t('Demo only · no real sale is recorded.');});
document.getElementById('demo-pay').addEventListener('click',()=>{const total=renderCart();if(!cart.size)return;cart.clear();renderCart();document.querySelector('#receipt-toast strong').textContent=format('Demo sale completed · {total} TJS',{total:money(total)});document.querySelector('#receipt-toast div>span').textContent=t('Try another sale by adding products.');});
renderCart();
document.querySelector('.receipt-total').setAttribute('aria-live','polite');
const views={
pos:{title:'A smooth sale. A clear record.',description:'Find products by name or barcode, build a basket, and take payment. Keep every receipt connected to your stock and money.',checks:['Multiple tenders on one sale','Customer credit and repayment tracking','Receipt history, returns, and cancellations'],table:'One sale. Three ways to pay.',head:['Payment method','Amount','Status'],rows:[['Cash','26.00 TJS','Recorded'],['Non-cash payment','20.00 TJS','Recorded'],['Customer credit','4.00 TJS','On account']],footer:'Illustrative split payment',total:'50.00 TJS'},
inventory:{title:'Know what’s on your shelves.',description:'Manage products, categories, barcodes, prices, and stock. Trace inventory through purchase layers, sales, counts, and write-off documents.',checks:['FIFO inventory and recorded costs','Physical counts with conflict checks','Separate write-offs and supplier returns'],table:'Your catalog, with context.',head:['Product','On hand','Status'],rows:[['Fresh milk','36 units','In stock'],['Basmati rice','48 kg','In stock'],['Green tea','4 packs','Low stock']],footer:'Illustrative inventory · last recorded stock',total:'Traceable movements'},
purchasing:{title:'From supplier to stockroom.',description:'Keep suppliers and purchase orders organized. Receive incoming goods into stock and follow purchase prices over time.',checks:['Supplier and purchase order records','Receive goods into inventory layers','Purchase reports and cost comparisons'],table:'A place for every delivery.',head:['Purchase order','Supplier','Status'],rows:[['PO #0081','Local dairy','Received'],['PO #0082','Grocery supplier','Received'],['PO #0083','Tea distributor','Ordered']],footer:'Illustrative purchasing workflow',total:'Connected to inventory'},
reports:{title:'Understand the numbers behind the day.',description:'Review turnover, returns, cost of goods, profit, purchase costs, and stock. Follow money separately from the value of goods sold.',checks:['Sales trends and top-selling products','Write-off costs shown separately','Period reports and reconciliation history'],table:'The story behind a trading day.',head:['Measure','Calculation','Amount'],rows:[['Net revenue','Sales less returns','1,200.00 TJS'],['Cost of goods','Recorded FIFO costs','860.00 TJS'],['Gross profit','Revenue less costs','340.00 TJS']],footer:'Illustrative figures · before write-off costs',total:'Source-based reporting'}
};
const panel=document.getElementById('workspace-panel');
function selectView(name){
const raw=views[name];
const translateValue=value=>Array.isArray(value)?value.map(translateValue):t(value);
const v=Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,translateValue(value)]));
document.querySelectorAll('[role=tab]').forEach(t=>{const selected=t.dataset.view===name;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;});
panel.setAttribute('aria-labelledby','tab-'+name);
panel.innerHTML='<div class="workspace-description"><h3>'+v.title+'</h3><p>'+v.description+'</p><ul class="check-list">'+v.checks.map(c=>'<li>'+c+'</li>').join('')+'</ul></div><div class="workspace-demo"><div class="table-top"><strong>'+v.table+'</strong><span>'+t('Example')+'</span></div><table class="demo-table"><caption class="sr-only">'+v.table+' '+t('Illustrative data.')+'</caption><thead><tr>'+v.head.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+v.rows.map((r,rowIndex)=>'<tr>'+r.map((c,i)=>'<td'+(i===1?' class="cell-blue"':'')+'>'+(i===2&&name!=='reports'?'<span class="status-label'+(['On account','Low stock','Ordered'].includes(raw.rows[rowIndex][i])?' pending':'')+'">'+c+'</span>':c)+'</td>').join('')+'</tr>').join('')+'</tbody></table><div class="demo-footer"><span>'+v.footer+'</span><strong>'+v.total+'</strong></div></div>';
}
document.querySelectorAll('[role=tab]').forEach((tab,index,all)=>{tab.addEventListener('click',()=>selectView(tab.dataset.view));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(index+1)%all.length;else if(e.key==='ArrowLeft')next=(index+all.length-1)%all.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=all.length-1;else return;e.preventDefault();selectView(all[next].dataset.view);all[next].focus();});});
selectView('pos');
const toggle=document.querySelector('.menu-toggle'),nav=document.getElementById('navigation');
function closeMenu(){toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label',t('Open navigation'));nav.classList.remove('open');}
toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',t(open?'Close navigation':'Open navigation'));nav.classList.toggle('open',open);});
nav.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){closeMenu();toggle.focus();}});
document.addEventListener('click',e=>{if(!e.target.closest('.header'))closeMenu();});
matchMedia('(min-width:901px)').addEventListener('change',e=>{if(e.matches)closeMenu();});
document.getElementById('year').textContent=new Date().getFullYear();
