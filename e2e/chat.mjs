// Chat gaps: screenshot upload -> review -> save, save failure, thread delete failure.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const M='http://localhost:54399',A='http://localhost:5199';
const log=async()=>JSON.parse(await (await fetch(M+'/log')).text());
const res=[];const ok=(n,c,d='')=>{res.push(c);console.log(c?'PASS':'FAIL',n,d)};
await fetch(M+'/set?fail=0');await log();
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox'],headless:'new'});
const p=await b.newPage();await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
let sawImage=false;
await p.setRequestInterception(true);
p.on('request',r=>{if(r.url().endsWith('/api/chat')){try{const j=JSON.parse(r.postData()||'{}');if(j.image)sawImage=true}catch{}return r.respond({status:200,contentType:'application/json',body:JSON.stringify({reply:'Sample reply from screenshot',values:[{kind:'instrument',id:'i1',value:1300}]})})}r.continue()});
await p.evaluateOnNewDocument(()=>{localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:99999,expires_at:Math.floor(Date.now()/1000)+99999,user:{id:'u1',email:'s@e.com',user_metadata:{}}}))});
p.on('dialog',d=>d.accept());
const click=t=>p.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(t)&&b.offsetParent);b&&b.click();return !!b},t);
const txt=()=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
fs.writeFileSync('/tmp/portify-e2e-sample.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64'));
const open=async()=>{await p.goto(A+'/Chat',{waitUntil:'networkidle2'});await sleep(800)};
// upload -> review -> save
await open();await (await p.$('input[type=file]')).uploadFile('/tmp/portify-e2e-sample.png');await sleep(800);
await p.click('button[aria-label="שליחת הודעה"]');await sleep(1500);
ok('screenshot is sent to the chat API and a review card appears',sawImage&&(await txt()).includes('Sample reply'));
await click('שמירת יתרות');await sleep(1500);let L=await log();
ok('review save after upload writes a Holding',L.some(x=>x.startsWith('POST Holding')),JSON.stringify(L));
// save failure
await open();await p.type('textarea','second');await p.click('button[aria-label="שליחת הודעה"]');await sleep(1500);await log();
await fetch(M+'/set?fail=1');await click('שמירת יתרות');await sleep(1200);await fetch(M+'/set?fail=0');
const t=await txt();ok('chat save failure shows an error and no values are claimed saved',/לא הצלחנו|שגיאה|נכשל|בקשת שמירה כבר נשלחה/.test(t)&&!/נשמרו \d+ יתרות/.test(t),t.slice(-200));
await p.screenshot({path:'/tmp/portify-e2e-chat-savefail.png'});
// thread delete failure
await open();await log();
await p.evaluate(()=>document.querySelector('button[aria-label^="מחיקת שיחה"]').click());await sleep(500);
await fetch(M+'/set?fail=1');await click('מחיקה')||await click('מחק');await sleep(1200);await fetch(M+'/set?fail=0');
ok('chat thread delete failure does not throw',errs.length===0,errs[0]||'');
console.log(res.filter(x=>!x).length,'failures of',res.length);await b.close();process.exit(res.every(Boolean)?0:1);
