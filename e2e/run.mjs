// Runs the whole e2e suite against a local mock backend. Sample data only. Never touches Supabase.
import { spawn } from 'child_process';
const procs=[];
const start=(cmd,args,env={})=>{const p=spawn(cmd,args,{env:{...process.env,...env},stdio:'ignore'});procs.push(p);return p};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
start('npx',['vite','--port','5199','--host','localhost'],{VITE_SUPABASE_URL:'http://localhost:54399',VITE_SUPABASE_ANON_KEY:'sample-key'});
await sleep(5000);
// Warm-up: the first browser load makes vite optimize dependencies and reload once. Result ignored.
{const m=start('node',['e2e/mock.mjs']);await sleep(800);
 await new Promise(res=>{const p=spawn('node',['e2e/desktop.mjs'],{stdio:'ignore'});p.on('exit',res)});m.kill();await sleep(300);}
let failed=0;
for(const f of (process.env.SUITES||'flows,mobile,crud,chat,desktop').split(',')){
  const mock=start('node',['e2e/mock.mjs']); // fresh sample data for every suite
  await sleep(800);
  const code=await new Promise(res=>{const p=spawn('node',[`e2e/${f}.mjs`],{stdio:'inherit'});p.on('exit',res)});
  mock.kill();await sleep(300);
  if(code!==0)failed++;
  console.log(`== ${f}: ${code===0?'ok':'FAILED'}`);
}
procs.forEach(p=>p.kill());
process.exit(failed?1:0);
