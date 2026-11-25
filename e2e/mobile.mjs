import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const M='http://localhost:54399', A='http://localhost:5199';
const log=async()=>JSON.parse(await (await fetch(M+'/log')).text());
const results=[];const ok=(n,c,d='')=>{results.push(c);console.log(c?'PASS':'FAIL',n,d)};
await fetch(M+'/set?fail=0');await fetch(M+'/targets?v=50');
var L;
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox'],headless:'new'});
const p=await b.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));
let chatMode='ok';await p.setRequestInterception(true);
p.on('request',r=>{if(r.url().endsWith('/api/chat')){if(chatMode==='ok')return r.respond({status:200,contentType:'application/json',body:JSON.stringify({reply:'Sample reply',values:[{kind:'instrument',id:'i1',value:1200}]})});return r.respond({status:503,contentType:'application/json',body:'{}'})}r.continue()});
await p.evaluateOnNewDocument(()=>{localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:99999,expires_at:Math.floor(Date.now()/1000)+99999,user:{id:'u1',email:'sample@example.com',user_metadata:{full_name:'Sample User'}}}))});
p.on('dialog',d=>d.accept());
const clickText=(t)=>p.evaluate((t)=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(t)&&b.offsetParent);if(!b)return false;b.click();return true},t);
const txt=()=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
// viewport matrix
for(const [w,h,m] of [[320,640,true],[390,844,true],[430,932,true],[1280,800,false]]){
 await p.setViewport({width:w,height:h,isMobile:m,hasTouch:m,deviceScaleFactor:1});
 for(const r of ['/','/Instruments','/AssetClasses','/PortfolioTimeline','/Chat']){
  errs.length=0;await p.goto(A+r,{waitUntil:'networkidle2'});await sleep(700);
  const ov=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok(`${w}px ${r}: no horizontal overflow, no JS errors`,ov<=0&&errs.length===0,`overflow=${ov} ${errs[0]||''}`);
  if(w===390&&r==='/PortfolioTimeline')await p.screenshot({path:'/tmp/portify-e2e-f_timeline.png',fullPage:true});
  if(w===390&&r==='/Instruments')await p.screenshot({path:'/tmp/portify-e2e-f_instruments.png'});
  if(w===390&&r==='/Chat')await p.screenshot({path:'/tmp/portify-e2e-f_chat.png'});
  if(w===320&&r==='/')await p.screenshot({path:'/tmp/portify-e2e-f_home320.png'});
 }}
await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
// sidebar nav on mobile
await p.goto(A+'/',{waitUntil:'networkidle2'});await p.evaluate(()=>document.querySelector('[data-sidebar=trigger]').click());await sleep(600);
let t=await txt();ok('mobile menu opens with navigation links',/Instruments/.test(t)&&/Asset Classes/i.test(t));await p.screenshot({path:'/tmp/portify-e2e-f_menu.png'});
// quick buy/sell invalid input
await p.goto(A+'/',{waitUntil:'networkidle2'});await sleep(800);await log();
await clickText('Buy');await sleep(500);L=await log();ok('quick buy with no instrument/amount sends nothing',!L.some(x=>x.startsWith('POST')),JSON.stringify(L));
// quick save invalid (negative)
await p.goto(A+'/Instruments',{waitUntil:'networkidle2'});await sleep(800);
const ins=await p.$$('input[type="number"],input[inputmode]');await ins[0].click({clickCount:3});await ins[0].type('-5');await clickText('Save all');await sleep(700);var L=await log();
ok('quick save with negative value is rejected with a message',!L.some(x=>x.startsWith('POST Holding'))&&/negative/.test(await txt()),JSON.stringify(L));await p.screenshot({path:'/tmp/portify-e2e-f_invalid.png'});
// save failure
await p.goto(A+'/Instruments',{waitUntil:'networkidle2'});await sleep(800);const ins2=await p.$$('input[type="number"],input[inputmode]');await ins2[0].click({clickCount:3});await ins2[0].type('1');await fetch(M+'/set?fail=1');await clickText('Save all');await sleep(900);t=await txt();
ok('save failure surfaces an error message',/fail|error|could not|couldn/i.test(t),t.slice(0,160));await p.screenshot({path:'/tmp/portify-e2e-f_savefail.png'});await fetch(M+'/set?fail=0');
// chat: history revisit + delete
await p.goto(A+'/Chat',{waitUntil:'networkidle2'});await sleep(800);
await p.type('textarea','history test');await p.click('button[aria-label="שליחת הודעה"]');await sleep(1500);
await clickText('ביטול');await sleep(300);await clickText('שיחה חדשה');await sleep(500);
await p.evaluate(()=>{[...document.querySelectorAll('aside button')].find(b=>b.innerText.includes('history test')).click()});await sleep(800);t=await txt();
ok('chat history thread can be reopened',t.includes('Sample reply'));
await p.evaluate(()=>document.querySelector('button[aria-label^="מחיקת שיחה"]').click());await sleep(500);await clickText('מחיקה')||await clickText('מחק');await sleep(900);L=await log();
ok('chat thread delete sends DELETE',L.some(x=>x.startsWith('DELETE')),JSON.stringify(L));
chatMode='503';await p.type('textarea','retry me');await p.click('button[aria-label="שליחת הודעה"]');await sleep(1200);chatMode='ok';await clickText('ניסיון חוזר');await sleep(1500);t=await txt();
ok('chat retry after failure gets a reply',t.includes('Sample reply'));
// chat image upload (synthetic png)
await p.goto(A+'/Chat',{waitUntil:'networkidle2'});await sleep(800);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
await (await import('fs')).promises.writeFile('/tmp/portify-e2e-sample.png',png);
const fi=await p.$('input[type=file]');await fi.uploadFile('/tmp/portify-e2e-sample.png');await sleep(800);
await p.click('button[aria-label="שליחת הודעה"]').catch(()=>{});await sleep(1500);t=await txt();
ok('chat screenshot upload goes through to review',t.includes('Sample reply'));await p.screenshot({path:'/tmp/portify-e2e-f_chat_upload.png'});
console.log(results.filter(x=>!x).length,'failures of',results.length);
await b.close();
