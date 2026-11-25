import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const M='http://localhost:54399',A='http://localhost:5199';
const log=async()=>JSON.parse(await (await fetch(M+'/log')).text());
const res=[];const ok=(n,c,d='')=>{res.push(c);console.log(c?'PASS':'FAIL',n,d)};
await fetch(M+'/set?fail=0');await fetch(M+'/targets?v=50');
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox'],headless:'new'});
const p=await b.newPage();await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.evaluateOnNewDocument(()=>{localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:99999,expires_at:Math.floor(Date.now()/1000)+99999,user:{id:'u1',email:'s@e.com',user_metadata:{}}}))});
p.on('dialog',d=>d.accept());
const go=async r=>{await p.goto(A+r,{waitUntil:'networkidle2'});await sleep(800)};
const click=t=>p.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(t)&&b.offsetParent);b&&b.click();return !!b},t);
const iconBtn=(re,i=0)=>p.evaluate((re,i)=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&[...b.querySelectorAll('svg')].some(v=>new RegExp(re,'i').test(v.getAttribute('class')||'')));bs[i]&&bs[i].click();return bs.length},re,i);
const pick=async(label,opt)=>{await p.evaluate(l=>{[...document.querySelectorAll('[role=combobox]')].find(c=>c.innerText.includes(l)).click()},label);await sleep(400);await p.evaluate(o=>{[...document.querySelectorAll('[role=option]')].find(x=>x.innerText.includes(o)).click()},opt);await sleep(300)};
await log();
// quick buy / sell
await go('/');await pick('Select instrument','Sample Fund A');await p.type('input[placeholder="Amount (₪)"]','100');await click('Buy');await sleep(900);let L=await log();
ok('quick buy sends POST Holding',L.some(x=>x.startsWith('POST Holding')),JSON.stringify(L));
await go('/');await pick('Select instrument','Sample Fund A');await p.type('input[placeholder="Amount (₪)"]','50');await click('Sell');await sleep(900);L=await log();
ok('quick sell sends POST Holding',L.some(x=>x.startsWith('POST Holding')),JSON.stringify(L));
await go('/');await pick('Select instrument','Sample Fund A');await p.type('input[placeholder="Amount (₪)"]','-5');await click('Buy');await sleep(700);L=await log();
ok('quick buy with negative amount is rejected with a message',!L.some(x=>x.startsWith('POST'))&&/greater than 0/.test(await p.evaluate(()=>document.body.innerText)),JSON.stringify(L));
// edit asset class
await go('/AssetClasses');await iconBtn('square-pen|edit|pen',0);await sleep(500);await p.click('#name',{clickCount:3});await p.type('#name','Stocks Renamed');await click('Update');await sleep(900);L=await log();
ok('edit asset class sends PATCH',L.some(x=>x.startsWith('PATCH')),JSON.stringify(L));
await go('/AssetClasses');ok('renamed class shown',(await p.evaluate(()=>document.body.innerText)).includes('Stocks Renamed'));
// manual asset CRUD
await go('/Instruments');await click('Add Manual Asset');await sleep(500);await p.type('#asset_name','Sample Savings');await click('Create');await sleep(900);L=await log();
ok('create manual asset sends POST ManualAsset',L.some(x=>x.startsWith('POST ManualAsset')),JSON.stringify(L));
await go('/Instruments');await click('Manage');await sleep(700);
const hasM=(await p.evaluate(()=>document.body.innerText)).includes('Sample Savings');ok('new manual asset listed',hasM);
// add value to manual asset
await p.evaluate(()=>{const h=[...document.querySelectorAll('h3,h4,div,p')].find(e=>e.children.length===0&&e.innerText==='Sample Savings');let n=h;for(let i=0;i<8&&n;i++){const b=[...n.querySelectorAll('button')].find(b=>b.innerText.includes('Add Value'));if(b){b.click();return}n=n.parentElement}});await sleep(600);
console.log('value form:',await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] input,[role=dialog] button')].map(e=>(e.id||e.type||'')+':'+(e.innerText||'').slice(0,12)).join('|')));
const vi=await p.$('#value_ils');
if(vi){await vi.type('777');await p.evaluate(()=>document.querySelector('[role=dialog] button[type=submit]').click());await sleep(900);L=await log();ok('manual value add sends POST ManualAssetValue',L.some(x=>x.startsWith('POST ManualAssetValue')),JSON.stringify(L));}else ok('manual value form has numeric input',false);
await go('/Instruments');await click('Manage');await sleep(700);
// edit manual asset, delete manual asset
const pens=await iconBtn('square-pen|edit|pen',0);console.log('edit btn count',pens);await sleep(500);
console.log('edit form:',await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] input,[role=dialog] button')].map(e=>(e.id||e.type||'')+':'+(e.innerText||'').slice(0,12)).join('|')));
await p.click('#asset_name',{clickCount:3});await p.type('#asset_name','Sample Savings 2');await click('Update');await sleep(900);L=await log();
ok('edit manual asset sends PATCH',L.some(x=>x.startsWith('PATCH')),JSON.stringify(L));
// edit instrument (pen buttons inside instrument cards)
await go('/Instruments');await click('Manage');await sleep(700);
const n=await iconBtn('square-pen|edit|pen',2);await sleep(500);
console.log('pen#2 dialog:',await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] input,[role=dialog] button')].map(e=>(e.id||e.type||'')+':'+(e.innerText||'').slice(0,12)).join('|')));
const nameField=await p.$('[role=dialog] input');
if(nameField){await nameField.click({clickCount:3});await nameField.type('Edited Name');await click('Update')||await click('Save');await sleep(900);L=await log();ok('second edit dialog submits PATCH',L.some(x=>x.startsWith('PATCH')),JSON.stringify(L));}
// value history delete
await go('/Instruments');await click('Manage');await sleep(700);await log();
await iconBtn('trash',3);await sleep(900);L=await log();ok('delete a value-history row sends DELETE',L.some(x=>x.startsWith('DELETE')),JSON.stringify(L));
// delete manual asset
await go('/Instruments');await click('Manage');await sleep(700);await log();
await iconBtn('trash',0);await sleep(900);L=await log();ok('delete manual asset sends DELETE',L.some(x=>x.startsWith('DELETE')),JSON.stringify(L));
// delete failure
await go('/Instruments');await click('Manage');await sleep(700);await fetch(M+'/set?fail=1');await log();
await iconBtn('trash',0);await sleep(900);await fetch(M+'/set?fail=0');
ok('delete failure shows an error and does not throw',errs.length===0&&/Could not delete/.test(await p.evaluate(()=>document.body.innerText)),errs[0]||'');
await p.keyboard.press('Escape');await sleep(300);
console.log('errors',errs.length,errs[0]||'');
console.log(res.filter(x=>!x).length,'failures of',res.length);
await b.close();
