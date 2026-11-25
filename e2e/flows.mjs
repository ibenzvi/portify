import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const M='http://localhost:54399', A='http://localhost:5199';
const log=async()=>JSON.parse(await (await fetch(M+'/log')).text());
const results=[];const ok=(n,c,d='')=>{results.push([c?'PASS':'FAIL',n,d]);console.log(c?'PASS':'FAIL',n,d)};
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox'],headless:'new'});
const p=await b.newPage();await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
let chatMode='ok';
await p.setRequestInterception(true);
p.on('request',r=>{ if(r.url().endsWith('/api/chat')){
  if(chatMode==='ok') return r.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({reply:'Sample reply: set Sample Fund A to 1200',values:[{kind:'instrument',id:'i1',value:1200}]})});
  return r.respond({status:chatMode==='429'?429:503,contentType:'application/json',body:'{}'});}
  r.continue();});
await p.evaluateOnNewDocument(()=>{localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:99999,expires_at:Math.floor(Date.now()/1000)+99999,user:{id:'u1',email:'sample@example.com',user_metadata:{full_name:'Sample User'}}}));});
p.on('dialog',d=>d.accept());
const go=async(r)=>{await p.goto(A+r,{waitUntil:'networkidle2'});await sleep(900)};
const clickText=(t)=>p.evaluate((t)=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(t));if(!b)return false;b.click();return true},t);
const txt=()=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
await fetch(M+'/set?fail=0');await fetch(M+'/targets?v=50');await log();
// routes
for(const r of ['/','/Instruments','/AssetClasses','/Chat','/NoSuchPage']){errs.length=0;await go(r);ok('route '+r+' loads without JS errors',errs.length===0,errs[0]||'')}
// dashboard
await go('/');let t=await txt();ok('dashboard shows sample total',t.includes('2,500'));
await p.type('#free-cash','300');await clickText('Rebalance');await sleep(600);t=await txt();ok('rebalance modal opens',/New Total/i.test(t));await p.screenshot({path:'/tmp/portify-e2e-e_rebalance.png'});await p.keyboard.press('Escape');
// total value chart replaces the timeline; no performance metrics anywhere
await go('/');await sleep(800);t=await txt();
ok('dashboard shows Total Value Over Time chart',t.includes('Total Value Over Time')&&await p.evaluate(()=>!!document.querySelector('[data-testid=total-value-chart] svg path.recharts-line-curve')));
ok('no return/performance/change metrics on dashboard',!/Change in Value|Annual Growth|Best Performer|Biggest Value Growth|Return/i.test(t));
await p.screenshot({path:'/tmp/portify-e2e-e_dashboard_chart.png',fullPage:true});
await go('/PortfolioTimeline');t=await txt();ok('old timeline page is gone (404, no timeline content)',/could not be found/.test(t)&&!/Change in Value|Annual Growth|Total Value Over Time/.test(t));
ok('no Timeline nav link',!(await p.evaluate(()=>[...document.querySelectorAll('a')].some(a=>/Timeline/.test(a.innerText)))));
// instruments quick save
await go('/Instruments');await log();
const inputs=await p.$$('input[type="number"],input[inputmode]');
ok('quick entry has inputs',inputs.length>=2,String(inputs.length));
await inputs[0].click({clickCount:3});await inputs[0].type('1100');
await clickText('Save all');await sleep(900);let L=await log();ok('quick save sends a POST for Holding',L.some(x=>x.startsWith('POST Holding')),JSON.stringify(L));
await p.screenshot({path:'/tmp/portify-e2e-e_quicksave.png'});
// manage: add instrument form
await clickText('Manage');await sleep(500);await p.screenshot({path:'/tmp/portify-e2e-e_manage.png',fullPage:true});
await clickText('Add Instrument');await sleep(1200);await p.screenshot({path:'/tmp/portify-e2e-dbg.png'});const di=await p.$('[role=dialog] input');await di.type('Sample Fund C');
await p.evaluate(()=>document.querySelector('[role=dialog] [role=combobox]').click());await sleep(400);
await p.evaluate(()=>[...document.querySelectorAll('[role=option]')].find(o=>o.innerText.includes('Stocks')).click());await sleep(300);
await p.screenshot({path:'/tmp/portify-e2e-e_addinst.png'});
await clickText('Create');await sleep(1000);L=await log();ok('add instrument submits (POST Instrument)',L.some(x=>x.startsWith('POST Instrument')),JSON.stringify(L));
// chat
await go('/Chat');await log();
await p.type('textarea','update sample fund a');await p.click('button[aria-label="שליחת הודעה"]');await sleep(1500);t=await txt();
ok('chat shows reply',t.includes('Sample reply'));await p.screenshot({path:'/tmp/portify-e2e-e_chat_reply.png',fullPage:true});

L=await log();
await p.screenshot({path:'/tmp/portify-e2e-e_chat_review.png',fullPage:true});console.log('chat buttons:',await p.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).join('|')));
const sv=await clickText('שמירת יתרות');await sleep(1500);L=await log();ok('chat reply values review + save writes Holding via upsert',sv&&L.some(x=>x.startsWith('POST Holding')),JSON.stringify(L));await p.screenshot({path:'/tmp/portify-e2e-e_chat_saved.png',fullPage:true});
chatMode='503';await clickText('שיחה חדשה');await sleep(500);await p.type('textarea','hello');await p.click('button[aria-label="שליחת הודעה"]');await sleep(1500);t=await txt();
await p.screenshot({path:'/tmp/portify-e2e-e_chat_err.png',fullPage:true});console.log('chat 503 text:',t.slice(-300));
// asset class create + delete
await go('/AssetClasses');await log();await clickText('Add Asset Class');await sleep(400);await p.type('#name','Sample Cash');await p.type('#target_percent','10');
await p.evaluate(()=>document.querySelector('form').requestSubmit());await sleep(900);L=await log();ok('create asset class (POST AssetClass)',L.some(x=>x.startsWith('POST AssetClass')),JSON.stringify(L));
await go('/AssetClasses');
const before=(await txt()).includes('Bonds');
await p.evaluate(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>[...b.querySelectorAll('svg')].some(v=>/trash/i.test(v.getAttribute('class')||'')));bs[1]&&bs[1].click()});await sleep(900);L=await log();
ok('delete asset class sends DELETE',before&&L.some(x=>x.startsWith('DELETE')),JSON.stringify(L));
await p.screenshot({path:'/tmp/portify-e2e-e_assetclasses.png',fullPage:true});
// instrument delete (manage)
await go('/Instruments');await clickText('Manage');await sleep(500);await log();
await p.evaluate(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>[...b.querySelectorAll('svg')].some(v=>/trash/i.test(v.getAttribute('class')||'')));bs[0]&&bs[0].click()});await sleep(1000);L=await log();
ok('delete instrument deletes its holdings (DELETE sent)',L.some(x=>x.startsWith('DELETE')),JSON.stringify(L));
// load error + retry
await fetch(M+'/set?fail=1');await go('/');t=await txt();ok('dashboard load failure shows error not zero',/Couldn.t load/i.test(t)&&!t.includes('₪0'));
await p.screenshot({path:'/tmp/portify-e2e-e_error.png'});await fetch(M+'/set?fail=0');await clickText('Try again');await sleep(1200);t=await txt();ok('Try again recovers',!/Couldn.t load/i.test(t)&&/Total Value/i.test(t));
console.log(results.filter(r=>r[0]==='FAIL').length,'failures of',results.length);
await b.close();
