# Reproducing the 2026-10-30 load audit

Companion to [the findings and measured results](2026-10-30-backend-load-audit.md).
This reproduces historical application code `9571805`, before the later
capacity commits. Use an isolated checkout at that revision (for example,
`git worktree add --detach /tmp/filspay-audit-9571805 9571805`, then install
its dependencies and run the commands there). Current-code measurements use
[the follow-up procedure](2026-10-30-capacity-follow-up.md#reproduce).
All commands run from the repository root. Use a **disposable local database**;
checkout and admin profiles create real fixture rows. This guide is
executable documentation; no performance fix or repository test/dependency
change is included.

## Prepare the database and tools

Create a fresh database, set `DATABASE_URL` to it, and set the ordinary
required development secrets (`WEBHOOK_SECRET_ENCRYPTION_KEY` must decode to
32 bytes; use the same key for seed and API). Then:

```bash
npm run migrate
npm run seed
mkdir -p /tmp/filspay-load-audit
npm install --prefix /tmp/filspay-load-audit/tools autocannon@8.0.0
```

Expand the large merchant with the same synthetic **authorized** records.
Run this once on that disposable database, through psql with DATABASE_URL:

```sql
INSERT INTO transactions
  (merchant_id,status,amount_fils,captured_fils,acquirer_reference,reference,occurred_at,created_at)
SELECT 'ce668d19-d805-469d-bc7e-d3b1741a6f16','authorized',4750,0,
       'load-ref-'||i,'LOAD-SEARCH-'||i,
       now()-interval '2 days'-(i%60)*interval '1 day'+(i%86400)*interval '1 second',
       now()-interval '2 days'-(i%60)*interval '1 day'+(i%86400)*interval '1 second'
FROM generate_series(1,20000) i;
ANALYZE transactions;
```

This grows the seeded Delta Wholesale merchant to 21,234 rows; the baseline
seed plus expansion totals 22,105 transactions. The expansion is not a
simulation of captured/settled financial history. It exercises list, search
and export row volume; summary/reconciliation use the seed's actual capture
history. Do not infer large-capture-history performance from those two tests.

## Start the test instance

Keep the normal development API on 3000. Start the isolated test API using
the disposable database environment:

```bash
export NODE_ENV=development OTP_DEV_EXPOSE=true PG_POOL_MAX=5
export ACQUIRER_RNG_SEED=209 ACQUIRER_FAILURE_RATE=0
export ACQUIRER_LATENCY_MIN_MS=100 ACQUIRER_LATENCY_MAX_MS=400
PORT=3138 node --import tsx apps/api/src/index.ts > /tmp/filspay-load-audit/load-api.log 2>&1 &
export LOAD_API_PID=$!
curl http://127.0.0.1:3138/readyz
```

Wait for readiness before starting the driver. The zero failure rate removes
intentional simulator declines from the capacity measurements; the normal
100–400 ms acquirer delay remains. This is test-only configuration.

## Driver used for the timed runs

Save the following as `/tmp/filspay-load-audit/run-load.mjs` and run it with
`node /tmp/filspay-load-audit/run-load.mjs`. It signs in with public seed
credentials, keeps cookies in a private local file, and writes sanitized
numeric results. It includes resource/DB-state sampling. Do not substitute
production credentials.

```javascript
import autocannon from './tools/node_modules/autocannon/autocannon.js';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const pg=createRequire(resolve('package.json'))('pg');
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const root='/tmp/filspay-load-audit';const api=process.env.LOAD_API_URL??'http://127.0.0.1:3138';const pid=Number(process.env.LOAD_API_PID);
const auth={};const results=[];const samples=[];let phase='setup';let sampling=false;
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
async function login(plane,merchantId,email,password){
 let cookie='';const prefix=plane==='admin'?'/v1/admin/auth':'/v1/auth';
 async function post(path,body){const r=await fetch(api+prefix+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});const cookies=r.headers.getSetCookie();if(cookies.length)cookie=cookies.map(c=>c.split(';')[0]).join('; ');const j=await r.json();if(!r.ok)throw new Error('login failed '+r.status);return j;}
 const step=await post('/login',{...(merchantId?{merchantId}:{}),email,password});await post('/otp/verify',{code:step.devOtpCode});return cookie;
}
const timer=setInterval(async()=>{if(sampling)return;sampling=true;try{
 const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');const rss=Number(status.match(/VmRSS:\s+(\d+)/)?.[1]??0)/1024;
 const waits=(await db.query(`SELECT state,wait_event_type,wait_event,count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY 1,2,3`)).rows;
 samples.push({at:new Date().toISOString(),phase,rssMiB:rss,waits});
 if(rss>700)throw new Error('Resource guard: API exceeds 700 MiB');
}catch(e){console.log('Sampling:',e.message);}finally{sampling=false;}},500);
function percentile(values,p){if(!values.length)return null;values.sort((a,b)=>a-b);return Number(values[Math.min(values.length-1,Math.ceil(values.length*p)-1)].toFixed(2));}
function save(){fs.writeFileSync(root+'/'+(process.env.RESULT_TAG??'results')+'.json',JSON.stringify({results,samples},null,2));}
async function bench(name,path,connections,duration,budget){phase=name;const latency=[];const start=performance.now();
 const result=await new Promise((resolve,reject)=>{const run=autocannon({url:api+path,connections,duration,pipelining:1,timeout:15,headers:name==='health'?{}:{cookie:auth.read}},(err,r)=>err?reject(err):resolve(r));run.on('response',(_c,_s,_b,time)=>latency.push(time));});
 const r={name,connections,durationMs:Number((performance.now()-start).toFixed(1)),completed:result.requests.total,rps:result.requests.average,statuses:result.statusCodeStats,errors:result.errors+result.non2xx,timeouts:result.timeouts,p50:percentile([...latency],.5),p95:percentile([...latency],.95),p99:percentile([...latency],.99),budgetMs:budget};r.pass=r.errors/Math.max(r.completed,1)<.01&&r.p95<budget;results.push(r);save();console.log(JSON.stringify(r));
}
async function payments(concurrency,duration){phase='checkout-'+concurrency;const errors=[];const latencies=[];const statuses={};let successful=0;const start=performance.now();const deadline=start+duration*1000;
 async function request(path,body,cookie){const r=await fetch(api+path,{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID(),...(cookie?{cookie}:{})},body:JSON.stringify(body)});const j=await r.json();statuses[r.status]=(statuses[r.status]??0)+1;if(!r.ok)throw new Error(`HTTP ${r.status} ${j.error??''}`);return j;}
 await Promise.all(Array.from({length:concurrency},async()=>{while(performance.now()<deadline){const begin=performance.now();try{
 const link=await request('/v1/merchants/eebd4250-3e67-4999-9ce9-f31e75486733/payment-links',{amountFils:47333,reference:'LOAD-'+crypto.randomUUID(),expiresAt:new Date(Date.now()+3600e3).toISOString()},auth.pay);
 const paid=await request('/v1/payment-links/'+link.token+'/pay',{card:{pan:'4242424242424242',expiryMonth:12,expiryYear:2030,cvv:'123'}});
 if(paid.status!=='paid')throw new Error('payment not paid');successful++;
 }catch(e){errors.push(e.message);}finally{latencies.push(performance.now()-begin);}}}));
 const durationMs=performance.now()-start;const errorCounts=Object.fromEntries([...new Set(errors)].map(e=>[e,errors.filter(x=>x===e).length]));
 const r={name:phase,connections:concurrency,durationMs:Number(durationMs.toFixed(1)),completed:latencies.length,successful,rps:Number((successful*1000/durationMs).toFixed(2)),statuses,errors:errors.length,errorCounts,p50:percentile([...latencies],.5),p95:percentile([...latencies],.95),p99:percentile([...latencies],.99),budgetMs:2000};r.pass=r.errors/Math.max(r.completed,1)<.01&&r.p95<2000;results.push(r);save();console.log(JSON.stringify(r));
}
try{
 auth.read=await login('merchant','ce668d19-d805-469d-bc7e-d3b1741a6f16','owner@deltawholesale.example','FilsPaySeed!2026');
 auth.pay=await login('merchant','eebd4250-3e67-4999-9ce9-f31e75486733','owner@deltamarketplace.example','FilsPaySeed!2026');
 auth.admin=await login('admin',null,'finance@filspay.test','FilsPayAdminSeed!2026');
 fs.writeFileSync(root+'/auth.json',JSON.stringify(auth),{mode:0o600});
 console.log('Authenticated sessions ready; cookies stored privately');
 const from=new Date(Date.now()-90*86400e3).toISOString().slice(0,10);const to=new Date(Date.now()+86400e3).toISOString().slice(0,10);const range=`from=${from}&to=${to}`;
 if(process.env.MIXED){
  await Promise.all([bench('list-during-checkout','/v1/transactions?limit=50',10,20,500),payments(30,20)]);
 }else{
 if(!process.env.PAYMENTS_ONLY){
 await bench('health','/healthz',50,5,500);
 await bench('transactions','/v1/transactions?limit=50',50,12,500);
 await bench('search-miss','/v1/transactions?limit=50&search=NO-SUCH-REFERENCE-LOAD',30,12,500);
 await bench('export','/v1/transactions/export?'+range,3,12,5000);
 await bench('settlement-summary','/v1/settlement/summary?'+range,20,12,500);
 await bench('reconciliation','/v1/settlement/reconciliation?'+range,20,12,500);
 }
 for(const c of (process.env.PAYMENTS_ONLY?[30,60]:[1,10,30,60]))await payments(c,process.env.PAYMENTS_ONLY?6:12);
}
}finally{clearInterval(timer);while(sampling)await new Promise(r=>setTimeout(r,20));save();await db.end();}
```

The driver runs the six read scenarios and four checkout concurrency levels.
Read/flow p95 thresholds are declared in the code and report. Its 500-ms RSS
sampler records observations; it is not a container memory limiter. The
sampling warning at 700 MiB is diagnostic, not a guarantee of safe resource
usage. Run under a real resource limit for a deployment certification.

For the **mixed workload**, use the normal-delay test API:

```bash
MIXED=1 RESULT_TAG=mixed node /tmp/filspay-load-audit/run-load.mjs
```

For the **zero-delay control**, stop the normal test instance and any
profiling instance first. Start the same code/pool configuration with
`ACQUIRER_LATENCY_MIN_MS=0 ACQUIRER_LATENCY_MAX_MS=0` on port 3140. Set
`LOAD_API_PID` to that process and run:

```bash
LOAD_API_URL=http://127.0.0.1:3140 PAYMENTS_ONLY=1 RESULT_TAG=zero-latency \
node /tmp/filspay-load-audit/run-load.mjs
```

The control uses two six-second runs. It diagnoses where time is spent; it
must not be presented as realistic acquirer performance. Stop the control
instance before running other measurements. Leave the user-facing backend's
normal acquirer settings unchanged.

## Count actual SQL statements

Stop timing runs first. Save the following preload as
`/tmp/filspay-load-audit/trace.mjs`. It instruments only requests carrying
`x-load-probe`, records statement text/timing without bound values, and binds
pool callbacks to the originating HTTP context. BEGIN/COMMIT and auth queries
are included. Summed parallel pool-wait/SQL spans can exceed wall time.
Do not use these instrumented request timings as the baseline load results.

```javascript
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const pg=createRequire(resolve('package.json'))('pg');
import {AsyncLocalStorage} from 'node:async_hooks';
import http from 'node:http';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const storage=new AsyncLocalStorage();
const originalEmit=http.Server.prototype.emit;
http.Server.prototype.emit=function(event,...args){
 if(event!=='request')return originalEmit.call(this,event,...args);
 const [req,res]=args;const label=req.headers['x-load-probe'];if(!label)return originalEmit.call(this,event,...args);
 const context={label,queryCount:0,queries:[],poolWaitMs:0,start:performance.now()};
 res.once('finish',()=>fs.appendFileSync('/tmp/filspay-load-audit/query-trace.jsonl',JSON.stringify({label,status:res.statusCode,elapsedMs:performance.now()-context.start,queryCount:context.queryCount,poolWaitMs:context.poolWaitMs,queries:context.queries})+'\n'));
 return storage.run(context,()=>originalEmit.call(this,event,...args));
};
const originalQuery=pg.Client.prototype.query;
pg.Client.prototype.query=function(...args){
 const context=storage.getStore();if(!context)return originalQuery.apply(this,args);
 const sql=typeof args[0]==='string'?args[0]:args[0]?.text??'<unknown>';
 const start=performance.now();context.queryCount++;
 const record=()=>context.queries.push({sql:sql.replace(/\s+/g,' ').trim(),durationMs:performance.now()-start});
 const callbackIndex=args.length-1;
 if(typeof args[callbackIndex]==='function'){
  const callback=args[callbackIndex];args[callbackIndex]=function(...result){record();return callback.apply(this,result);};return originalQuery.apply(this,args);
 }
 const result=originalQuery.apply(this,args);
 if(result&&typeof result.then==='function')return result.then(value=>{record();return value;},error=>{record();throw error;});
 return result;
};
const originalConnect=pg.Pool.prototype.connect;
pg.Pool.prototype.connect=function(callback){
 const context=storage.getStore();if(!context)return originalConnect.call(this,callback);
 const start=performance.now();const record=()=>{context.poolWaitMs+=performance.now()-start;};
 if(typeof callback==='function')return originalConnect.call(this,function(...args){record();return storage.run(context,()=>callback.apply(this,args));});
 return originalConnect.call(this).then(client=>{record();return client;},error=>{record();throw error;});
};
```

Start the disposable API on 3139 with the preload, retaining normal delays:

```bash
PORT=3139 node --import tsx --import /tmp/filspay-load-audit/trace.mjs apps/api/src/index.ts
```

In another terminal with the same disposable database environment, save the
following as `/tmp/filspay-load-audit/profile.mjs` and run it from the repo
root. It reuses the private authenticated sessions created by the load
runner and creates review/status-repair fixtures in the disposable database.
It submits bulk KYC batches of 1/10/100/200 and repairs 1/10/100 dirty statuses.
The table in the report comes from `query-trace.jsonl`.

```javascript
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const pg=createRequire(resolve('package.json'))('pg');
import fs from 'node:fs';
const auth=JSON.parse(fs.readFileSync('/tmp/filspay-load-audit/auth.json','utf8'));
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const api='http://127.0.0.1:3139';
async function request(label,path,cookie,body){const response=await fetch(api+path,{method:body?'POST':'GET',headers:{cookie,'x-load-probe':label,'content-type':'application/json',...(body?{'Idempotency-Key':crypto.randomUUID()}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(label+' HTTP '+response.status);console.log(label,response.status);return result;}
try{
 for(const n of [1,10,50,100])await request('transactions-'+n,'/v1/transactions?limit='+n,auth.read);
 const from=new Date(Date.now()-90*86400e3).toISOString().slice(0,10),to=new Date(Date.now()+86400e3).toISOString().slice(0,10);
 await request('search-miss','/v1/transactions?search=NO-SUCH-REFERENCE-LOAD&limit=50',auth.read);
 await request('reconciliation','/v1/settlement/reconciliation?from='+from+'&to='+to,auth.read);
 const link=await request('checkout-create','/v1/merchants/eebd4250-3e67-4999-9ce9-f31e75486733/payment-links',auth.pay,{amountFils:47333,expiresAt:new Date(Date.now()+3600e3).toISOString()});
 await request('checkout-pay','/v1/payment-links/'+link.token+'/pay','',{card:{pan:'4242424242424242',expiryMonth:12,expiryYear:2030,cvv:'123'}});
 for(const n of [1,10,100,200]){
  const merchants=(await db.query("INSERT INTO merchants(display_name,onboarding_status) SELECT 'Load audit KYC '||i,'under_review' FROM generate_series(1,$1::int) i RETURNING id",[n])).rows.map(r=>r.id);
  const result=await request('bulk-kyc-'+n,'/v1/admin/merchants/bulk-approve',auth.admin,{merchantIds:merchants});if(result.approvedCount!==n)throw new Error('unexpected approval count');
 }
 for(const n of [1,10,100]){
  const m=(await db.query("INSERT INTO merchants(display_name) VALUES('Load audit recompute') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,refunded_fils,acquirer_reference) SELECT $1,'captured',1000,1000,100,'load-recompute-'||i FROM generate_series(1,$2::int) i",[m,n]);
  const result=await request('recompute-'+n,`/v1/admin/merchants/${m}/transactions/recompute-statuses`,auth.admin,{});if(result.updated!==n)throw new Error('unexpected recompute count');
 }
}finally{await db.end();}
```

## Interpretation and cleanup

- The screen is closed-loop and short, with no imposed container limits.
  Increase duration and reproduce the deployment's CPU/RAM budget before
  drawing production capacity conclusions.
- Zero HTTP errors does not imply acceptable p95 latency.
- A constant two-query list endpoint is not N+1 merely because it scans many
  rows. Conversely, the measured 2N+6 bulk approvals and N+7 changed-status
  requests demonstrate per-row statement growth.
- These profiles mutate fixtures. Stop temporary test/profiling processes
  after collecting evidence. Keep the normal development backend running.
- Keep environment/cookie files private and out of git. The report contains
  durable metrics; local JSON/logs provide the detailed run evidence.

Official tool documentation: [Autocannon](https://github.com/mcollina/autocannon),
[k6 installation](https://grafana.com/docs/k6/latest/set-up/install-k6/), and
[k6 virtual users / ramping](https://grafana.com/docs/k6/latest/get-started/running-k6/).
Autocannon was used in this audit. k6 is an alternative for longer scripted
workload suites; it was not installed or used for these measurements.
