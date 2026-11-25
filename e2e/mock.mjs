import http from 'http';
let fail = true;
const now='2026-11-01T00:00:00Z';
function one(q,a){if((q.headers.accept||'').includes('pgrst.object')){return JSON.stringify(a[0]||{})}return JSON.stringify(a)}
const LOG=[];let seq=100;
const D={
 AssetClass:[{id:'ac1',data:{name:'Stocks',target_percent:0}},{id:'ac2',data:{name:'Bonds',target_percent:0}}],
 Instrument:[{id:'i1',data:{name:'Sample Fund A',asset_class_id:'ac1',currency:'ILS'}},{id:'i2',data:{name:'Sample Fund B',asset_class_id:'ac2',currency:'ILS'}}],
 Holding:[{id:'h1',data:{instrument_id:'i1',date:'2026-10-01',total_value_ils:1000}},{id:'h2',data:{instrument_id:'i2',date:'2026-10-01',total_value_ils:500}},{id:'h3',data:{instrument_id:'i1',date:'2026-11-01',total_value_ils:1000}},{id:'h4',data:{instrument_id:'i2',date:'2026-11-01',total_value_ils:1500}}],
 ManualAsset:[],ManualAssetValue:[]};
http.createServer((q,s)=>{
 s.setHeader('access-control-allow-origin','*');s.setHeader('access-control-allow-headers','*');s.setHeader('access-control-allow-methods','*');
 if(q.method==='OPTIONS'){s.end();return;}
 const u=new URL(q.url,'http://x');
 if(u.pathname==='/targets'){D.AssetClass.forEach(a=>a.data.target_percent=+u.searchParams.get('v'));s.end('ok');return;}
 if(u.pathname==='/set'){fail=u.searchParams.get('fail')==='1';s.end('ok');return;}
 if(u.pathname==='/log'){s.end(JSON.stringify(LOG));LOG.length=0;return;}
 if(u.pathname.startsWith('/rest/v1/records')&&q.method!=='GET'&&fail){s.statusCode=500;s.setHeader('content-type','application/json');s.end('{"message":"sample write failure"}');return;}
 if(u.pathname.startsWith('/rest/v1/records')&&q.method!=='GET'){
  let body='';q.on('data',c=>body+=c);q.on('end',()=>{
   s.setHeader('content-type','application/json');
   if(q.method==='DELETE'){const id=(u.searchParams.get('id')||'').replace('eq.','');for(const k in D)D[k]=D[k].filter(r=>r.id!==id);LOG.push('DELETE '+id);s.statusCode=204;s.end();return;}
   let j=body?JSON.parse(body):{};
   if(q.method==='POST'){const rows=(Array.isArray(j)?j:[j]).map(r=>({id:'n'+(seq++),created_date:now,updated_date:now,...r}));rows.forEach(r=>{const L2=(D[r.entity]=D[r.entity]||[]);if(!L2.some(x=>x.id===r.id))L2.push({id:r.id,data:r.data,updated_date:r.updated_date})});LOG.push('POST '+rows.map(r=>r.entity).join(','));s.statusCode=201;s.end(one(q,rows));return;}
   if(q.method==='PATCH'){const id=(u.searchParams.get('id')||'').replace('eq.','');const ud=(u.searchParams.get('updated_date')||'').replace('eq.','');let hit=null;for(const k in D)D[k].forEach(r=>{if(r.id===id&&(!ud||ud===r.updated_date)){r.data=j.data||r.data;if(j.updated_date)r.updated_date=j.updated_date;hit={entity:k,...r}}});LOG.push('PATCH '+id);s.end(one(q,hit?[hit]:[]));return;}
   s.end('[]');});
  return;}
 if(u.pathname.startsWith('/rest/v1/records')){
  if(fail){s.statusCode=500;s.setHeader('content-type','application/json');s.end('{"message":"sample network failure"}');return;}
  const e=(u.searchParams.get('entity')||'').replace('eq.','');
  s.setHeader('content-type','application/json');
  const idf=u.searchParams.get('id');
  if(idf&&idf.startsWith('in.(')){const ids=idf.slice(4,-1).split(',').map(x=>x.replace(/"/g,''));const out=[];for(const k in D)D[k].forEach(r=>{if(ids.includes(r.id))out.push({entity:k,created_date:now,updated_date:now,...r})});s.end(JSON.stringify(out));return;}
  let rows=(D[e]||[]).map(r=>({entity:e,created_date:now,updated_date:now,title:r.data&&r.data.title,...r}));
  if(idf&&idf.startsWith('eq.'))rows=rows.filter(r=>r.id===idf.slice(3));
  s.end(one(q,rows));return;}
 s.statusCode=404;s.end('{}');
}).listen(54399);
