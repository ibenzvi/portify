// Desktop (1280px) visual regression: saves screenshots to /tmp/portify-e2e-desktop-*.png and checks layout.
import puppeteer from 'puppeteer-core';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const A='http://localhost:5199';const res=[];const ok=(n,c,d='')=>{res.push(c);console.log(c?'PASS':'FAIL',n,d)};
await fetch('http://localhost:54399/set?fail=0');await fetch('http://localhost:54399/targets?v=50');
const b=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox'],headless:'new'});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.evaluateOnNewDocument(()=>{localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'a',refresh_token:'r',token_type:'bearer',expires_in:99999,expires_at:Math.floor(Date.now()/1000)+99999,user:{id:'u1',email:'s@e.com',user_metadata:{}}}))});
for(const [r,n] of [['/','home'],['/Instruments','instruments'],['/AssetClasses','classes'],['/Chat','chat']]){
 errs.length=0;await p.goto(A+r,{waitUntil:'networkidle2'});await sleep(800);
 const sidebar=await p.evaluate(()=>!!document.querySelector('[data-sidebar=sidebar]')&&document.querySelector('[data-sidebar=sidebar]').getBoundingClientRect().width>100);
 const menuHidden=await p.evaluate(()=>{const b=document.querySelector('[data-sidebar=trigger]');return !b||!b.offsetParent});
 const ov=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 ok(`desktop ${r}: sidebar visible, mobile menu button hidden, no overflow, no JS errors`,sidebar&&menuHidden&&ov<=0&&errs.length===0,`sidebar=${sidebar} menuHidden=${menuHidden} ov=${ov} ${errs[0]||''}`);
 await p.screenshot({path:`/tmp/portify-e2e-desktop-${n}.png`});
 if(r==='/'){const t=await p.evaluate(()=>document.body.innerText);ok('desktop dashboard has value chart, no performance metrics',t.includes('Total Value Over Time')&&!/Change in Value|Best Performer|Annual Growth/.test(t));}
 // desktop nav keeps sidebar after clicking a tab

}
await p.goto(A+'/',{waitUntil:'networkidle2'});await p.evaluate(()=>[...document.querySelectorAll('a')].find(a=>a.innerText.includes('Instruments')).click());await sleep(600);
ok('desktop: sidebar stays visible after choosing a tab',await p.evaluate(()=>document.querySelector('[data-sidebar=sidebar]').getBoundingClientRect().width>100));
console.log(res.filter(x=>!x).length,'failures of',res.length);await b.close();process.exit(res.every(Boolean)?0:1);
