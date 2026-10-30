#!/usr/bin/env node
/** Comparative, destructive fixture checks. Use a DISPOSABLE migrated DB.
 * CAPACITY_FIXTURE_DB=1 DATABASE_URL=... BASELINE_REPO=/path/to/11919ca \
 *   node --import tsx scripts/load/capacity-remaining.verify.mjs
 * CAPACITY_REPORT writes the measurement/compatibility record.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

if (process.env.CAPACITY_FIXTURE_DB !== '1' || !process.env.DATABASE_URL) throw new Error('Disposable DATABASE_URL and CAPACITY_FIXTURE_DB=1 required (writes fixtures).');
const baseline=resolve(process.env.BASELINE_REPO??'.');
const load=(root,path)=>import(pathToFileURL(resolve(root,path)).href);
if(process.argv[2]==='--csv-child'){
 const root=process.argv[3]==='before'?baseline:resolve('.');
 const {buildTransactionsExportCsv}=await load(root,'apps/api/src/transactions/exportCsv.ts');
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,options:'-c max_parallel_workers_per_gather=0'});
 try{const started=performance.now();const csv=await buildTransactionsExportCsv(pool,{merchantId:process.argv[4]});console.log(JSON.stringify({ms:performance.now()-started,peakRssMiB:process.resourceUsage().maxRSS/1024,bytes:Buffer.byteLength(csv),sha256:createHash('sha256').update(csv).digest('hex')}));}finally{await pool.end();}
 process.exit(0);
}
const before={},after={};
for(const [name,path] of Object.entries({search:'apps/api/src/transactions/query.ts',csv:'apps/api/src/transactions/exportCsv.ts',imports:'apps/api/src/admin/adjustmentImport.ts',reporting:'apps/reporting/src/consumer/runConsumerPass.ts',webhooks:'apps/api/src/webhooks/dispatcher.ts'})){
 before[name]=await load(baseline,path);after[name]=await load('.',path);
}
const {loadConfig}=await load('.','apps/api/src/config.ts');
const {createWebhookEndpoint}=await load('.','apps/api/src/webhooks/create.ts');
const {verifyRawBody}=await load('.','apps/api/src/webhooks/sign.ts');
const {WEBHOOK_SIGNATURE_HEADER,WEBHOOK_DELIVERY_ID_HEADER}=await load('.','apps/api/src/webhooks/headers.ts');
const config=loadConfig({DATABASE_URL:process.env.DATABASE_URL,NODE_ENV:'test',WEBHOOK_SECRET_ENCRYPTION_KEY:'Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=',WEBHOOK_MAX_ATTEMPTS:'3',WEBHOOK_BACKOFF_BASE_MS:'1000',WEBHOOK_BACKOFF_CAP_MS:'60000'});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,options:'-c max_parallel_workers_per_gather=0'});
// Parallel sorts already reorder timestamp ties between unchanged baseline runs.
// Use the same deterministic database plan for byte comparisons; production SQL is unchanged.
const report={baseline,comparisonPgOptions:'max_parallel_workers_per_gather=0',checks:[],measurements:[]};
let counting=false,queries=0,rejectAudit=false,dueOrder=null;
const query=pg.Client.prototype.query;
pg.Client.prototype.query=function(...args){
 const sql=typeof args[0]==='string'?args[0]:args[0]?.text??'';
 if(counting)queries++;
 if(rejectAudit&&sql.includes('INSERT INTO admin_audit_log')){rejectAudit=false;return Promise.reject(new Error('forced audit failure'));}
 const inspect=result=>{if(dueOrder&&sql.includes('WHERE wd.status ='))dueOrder.push(...result.rows);return result;};
 if(dueOrder&&sql.includes('WHERE wd.status =')){
  if(typeof args.at(-1)==='function'){const callback=args.at(-1);args[args.length-1]=(error,result)=>{if(!error)inspect(result);callback(error,result);};}
  else return query.apply(this,args).then(inspect);
 }
 return query.apply(this,args);
};
const pass=message=>{report.checks.push(message);console.log('PASS',message);};
async function measure(name,fn){queries=0;counting=true;const start=performance.now();try{const result=await fn();const metric={name,ms:+(performance.now()-start).toFixed(3),queries};report.measurements.push(metric);console.log(JSON.stringify(metric));return result;}finally{counting=false;}}
async function merchant(label){return(await pool.query('INSERT INTO merchants(display_name) VALUES($1) RETURNING id',['Capacity '+label])).rows[0].id;}
async function errorOf(fn){try{await fn();assert.fail('expected error');}catch(error){return{name:error.name,code:error.code,message:error.message};}}
try{
 // Prevent old seed receiver work from becoming a test transport target.
 await pool.query("UPDATE webhook_endpoints SET status='disabled'");
 const searchMerchant=await merchant('search/CSV');
 await pool.query(`INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,reference,acquirer_reference,occurred_at)
 SELECT $1,'authorized',4755,0,CASE i%7 WHEN 0 THEN NULL WHEN 1 THEN '=formula' WHEN 2 THEN E'quoted,"line"\nnext' ELSE 'Order-Item-'||i END,
 repeat('wide-unused-acquirer-',25)||i,'2026-09-01T00:00Z'::timestamptz+i*interval '1 second' FROM generate_series(1,20000)i`,[searchMerchant]);
 await pool.query("UPDATE transactions SET occurred_at='2026-09-01T00:30Z' WHERE id IN(SELECT id FROM transactions WHERE merchant_id=$1 ORDER BY id LIMIT 200)",[searchMerchant]);
 // Compare settled index state; VACUUM also flushes GIN's bulk-insert pending list.
 await pool.query('VACUUM (ANALYZE) transactions');
 const anId=(await pool.query('SELECT id FROM transactions WHERE merchant_id=$1 LIMIT 1',[searchMerchant])).rows[0].id;
 const filters=[undefined,'NO-SUCH-REFERENCE-WAVE2','Order-Item-1849','%','_','\\',anId,anId.toUpperCase(),anId.slice(0,8),''];
 const expected=[];let statement;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const index of ['idx_transactions_reference_trgm','idx_transactions_acquirer_reference_trgm','idx_transactions_id_text'])await client.query('DROP INDEX '+index);
  for(const search of filters)expected.push(await before.search.listTransactions(client,{merchantId:searchMerchant,search,limit:17}));
  const recording={query:(text,values)=>{statement={text,values};return client.query(text,values);}};
  await measure('search-miss-before',()=>before.search.listTransactions(recording,{merchantId:searchMerchant,search:filters[1],limit:50}));
  report.searchPlanBefore=(await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.text,statement.values)).rows[0]['QUERY PLAN'];
 }finally{await client.query('ROLLBACK');client.release();}
 for(let i=0;i<filters.length;i++)assert.deepEqual(await after.search.listTransactions(pool,{merchantId:searchMerchant,search:filters[i],limit:17}),expected[i]);
 await measure('search-miss-after',()=>after.search.listTransactions(pool,{merchantId:searchMerchant,search:filters[1],limit:50}));
 report.searchPlanAfter=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.text,statement.values)).rows[0]['QUERY PLAN'];
 const first=await after.search.listTransactions(pool,{merchantId:searchMerchant,limit:100});
 const second=await after.search.listTransactions(pool,{merchantId:searchMerchant,limit:100,cursor:first.nextCursor});
 assert.deepEqual(second,await before.search.listTransactions(pool,{merchantId:searchMerchant,limit:100,cursor:first.nextCursor}));
 assert.ok(!first.transactions.some(a=>second.transactions.some(b=>a.id===b.id)));
 pass('search results/cursors match without and with indexes: substrings, wildcards, nulls, UUID spelling and pagination');
 for(const filter of [{merchantId:searchMerchant},{merchantId:searchMerchant,status:['captured']},{merchantId:searchMerchant,status:[]},{merchantId:searchMerchant,from:new Date('2026-09-01T00:10Z'),to:new Date('2026-09-01T00:31Z')}])assert.equal(await after.csv.buildTransactionsExportCsv(pool,filter),await before.csv.buildTransactionsExportCsv(pool,filter));
 const csv=[];
 for(const which of ['before','after']){
  const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'--csv-child',which,searchMerchant],{env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);csv.push(JSON.parse(child.stdout.trim()));
 }
 assert.equal(csv[0].sha256,csv[1].sha256);report.csvMemory={before:csv[0],after:csv[1]};
 const invalidMerchant=await merchant('CSV error');
 await pool.query("INSERT INTO transactions(merchant_id,status,amount_fils,acquirer_reference) VALUES($1,'authorized',9007199254740992,'unsafe-CSV-test')",[invalidMerchant]);
 assert.deepEqual(await errorOf(()=>after.csv.buildTransactionsExportCsv(pool,{merchantId:invalidMerchant})),await errorOf(()=>before.csv.buildTransactionsExportCsv(pool,{merchantId:invalidMerchant})));
 await pool.query('SELECT 1');
 pass('buffered CSV bytes match for 20000 rows with timestamp ties, escaping and filters; formatting errors drain/release the connection');

 const admin=(await pool.query("INSERT INTO admin_users(email,password_hash,display_name,role) VALUES($1,'fixture','Capacity','finance') RETURNING id",['capacity-'+randomUUID()+'@example.test'])).rows[0].id;
 const importMerchant=await merchant('imports');
 const importInput={adminUserId:admin,originalFilename:'capacity.csv',rows:Array.from({length:1001},(_,i)=>({merchantId:importMerchant,amount:['4.755',' 4.75 ','0','-1.250'][i%4],reason:i%3?'preserved reason':undefined}))};
 async function resetImport(){await pool.query('DELETE FROM adjustment_import_rows WHERE merchant_id=$1',[importMerchant]);await pool.query('DELETE FROM ledger_entries WHERE merchant_id=$1',[importMerchant]);await pool.query('INSERT INTO merchant_balances(merchant_id,cached_payable_fils,updated_at) VALUES($1,1234,now()) ON CONFLICT(merchant_id) DO UPDATE SET cached_payable_fils=1234',[importMerchant]);}
 async function importSnapshot(result){
  const rows=await after.imports.getAdjustmentImportRows(pool,result.importId);
  const normalized=[];
  for(const row of rows){const legs=row.ledgerEntryGroupId?(await pool.query('SELECT account_id,direction,amount_fils,description FROM ledger_entries WHERE entry_group_id=$1 ORDER BY id',[row.ledgerEntryGroupId])).rows:[];normalized.push({...row,ledgerEntryGroupId:row.ledgerEntryGroupId?'present':null,legs});}
  const balance=(await pool.query('SELECT cached_payable_fils::text AS balance FROM merchant_balances WHERE merchant_id=$1',[importMerchant])).rows[0].balance;
  const audit=(await pool.query('SELECT action,metadata,outcome FROM admin_audit_log WHERE target_id=$1',[result.importId])).rows;
  return{rowCount:result.rowCount,totalPostedFils:result.totalPostedFils,rows:normalized,balance,audit};
 }
 await resetImport();const a=await measure('import-1001-before',()=>before.imports.applyAdjustmentImport(pool,importInput));const snapshot=await importSnapshot(a);
 await resetImport();const b=await measure('import-1001-after',()=>after.imports.applyAdjustmentImport(pool,importInput));assert.deepEqual(await importSnapshot(b),snapshot);
 for(const implementation of [before,after]){
  await resetImport();rejectAudit=true;await assert.rejects(implementation.imports.applyAdjustmentImport(pool,importInput),/forced audit failure/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger_entries WHERE merchant_id=$1',[importMerchant])).rows[0].n,0);
  assert.equal((await pool.query('SELECT cached_payable_fils::text AS n FROM merchant_balances WHERE merchant_id=$1',[importMerchant])).rows[0].n,'1234');
 }
 const invalid={...importInput,rows:[...importInput.rows.slice(0,500),{merchantId:importMerchant,amount:'4.7555'}]};
 await resetImport();assert.deepEqual(await errorOf(()=>after.imports.applyAdjustmentImport(pool,invalid)),await errorOf(()=>before.imports.applyAdjustmentImport(pool,invalid)));
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger_entries WHERE merchant_id=$1',[importMerchant])).rows[0].n,0);
 pass('1001-row imports match row numbers/raw amounts/signed totals/ledger legs/cache/audit; malformed rows and failed audits roll back across batches');

 await pool.query("INSERT INTO reporting_outbox_cursor(consumer_name,last_processed_id) VALUES('reporting',0) ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO reporting_processed_events(consumer_name,outbox_event_id) SELECT 'reporting',id FROM outbox_events ON CONFLICT DO NOTHING");
 const reportingMerchant=await merchant('reporting');
 const events=(await pool.query(`INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload,created_at)
 SELECT CASE WHEN i%2=0 THEN 'transaction.captured' ELSE 'transaction.voided' END,'transaction',gen_random_uuid(),jsonb_build_object('merchantId',$1::text,'amountCapturedFils',4755),'2026-09-01T00:00Z' FROM generate_series(1,500)i RETURNING id`,[reportingMerchant])).rows.map(r=>r.id);
 async function resetReporting(){await pool.query("DELETE FROM reporting_processed_events WHERE consumer_name='reporting' AND outbox_event_id=ANY($1::bigint[])",[events]);await pool.query('DELETE FROM merchant_daily_volume WHERE merchant_id=$1',[reportingMerchant]);await pool.query("UPDATE reporting_outbox_cursor SET last_processed_id=0 WHERE consumer_name='reporting'");}
 async function reportingSnapshot(){return{rollups:(await pool.query('SELECT volume_date,captured_count,captured_gross_fils::text,voided_count FROM merchant_daily_volume WHERE merchant_id=$1 ORDER BY volume_date',[reportingMerchant])).rows,receipts:(await pool.query("SELECT outbox_event_id::text FROM reporting_processed_events WHERE consumer_name='reporting' AND outbox_event_id=ANY($1::bigint[]) ORDER BY outbox_event_id",[events])).rows,cursor:(await pool.query("SELECT last_processed_id::text FROM reporting_outbox_cursor WHERE consumer_name='reporting'")).rows};}
 await resetReporting();assert.deepEqual(await measure('reporting-500-before',()=>before.reporting.runConsumerPass(pool,{consumerBatchLimit:500})),{processedCount:500});const reportingExpected=await reportingSnapshot();
 await resetReporting();assert.deepEqual(await measure('reporting-500-after',()=>after.reporting.runConsumerPass(pool,{consumerBatchLimit:500})),{processedCount:500});assert.deepEqual(await reportingSnapshot(),reportingExpected);
 assert.deepEqual(await after.reporting.runConsumerPass(pool,{consumerBatchLimit:500}),{processedCount:0});
 await resetReporting();const parallel=await Promise.all([after.reporting.runConsumerPass(pool,{consumerBatchLimit:500}),after.reporting.runConsumerPass(pool,{consumerBatchLimit:500})]);assert.deepEqual(parallel.map(r=>r.processedCount).sort((a,b)=>a-b),[0,500]);assert.deepEqual(await reportingSnapshot(),reportingExpected);
 pass('500 reporting events retain exact rollups/receipts/cursor, repeated passes and concurrent consumer serialization');
 for(const implementation of [before,after]){
  const ids=(await pool.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.captured','transaction',gen_random_uuid(),jsonb_build_object('merchantId',$1::text,'amountCapturedFils',10)),('transaction.captured','transaction',gen_random_uuid(),jsonb_build_object('merchantId',$1::text)) RETURNING id",[reportingMerchant])).rows.map(r=>r.id);
  const original=await reportingSnapshot();await assert.rejects(implementation.reporting.runConsumerPass(pool,{consumerBatchLimit:500}));assert.deepEqual(await reportingSnapshot(),original);assert.equal((await pool.query('SELECT count(*)::int AS n FROM reporting_processed_events WHERE outbox_event_id=ANY($1::bigint[])',[ids])).rows[0].n,0);await pool.query('DELETE FROM outbox_events WHERE id=ANY($1::bigint[])',[ids]);
 }
 const lower=await pool.connect();
 try{
  await lower.query('BEGIN');await lower.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.voided','transaction',gen_random_uuid(),jsonb_build_object('merchantId',$1::text))",[reportingMerchant]);
  await pool.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.voided','transaction',gen_random_uuid(),jsonb_build_object('merchantId',$1::text))",[reportingMerchant]);
  assert.equal((await after.reporting.runConsumerPass(pool,{consumerBatchLimit:500})).processedCount,1);await lower.query('COMMIT');assert.equal((await after.reporting.runConsumerPass(pool,{consumerBatchLimit:500})).processedCount,1);
 }finally{await lower.query('ROLLBACK');lower.release();}
 pass('reporting batch receipts roll back with a failing applier and still admit late-committing lower IDs');

 const webhookMerchant=await merchant('webhooks');
 const endpoints=[];
 for(let i=0;i<4;i++)endpoints.push(await createWebhookEndpoint(pool,config,{merchantId:webhookMerchant,url:'https://capacity-receiver.invalid/'+i,createdByType:'merchant_session',createdById:randomUUID()}));
 await pool.query(`INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload)
 SELECT 'transaction.captured','transaction',gen_random_uuid(),jsonb_build_object('merchantId',$1::text,'amountCapturedFils',4755,'feeFils',119,'newStatus','captured','capturedTotalFils',4755) FROM generate_series(1,20)`,[webhookMerchant]);
 let webhookExpected;
 for(const [name,implementation] of [['before',before],['after',after]]){
  await pool.query('DELETE FROM webhook_deliveries WHERE endpoint_id=ANY($1::uuid[])',[endpoints.map(e=>e.id)]);
  const calls=[],activeByEndpoint=new Set();let active=0,peak=0;dueOrder=[];
  const transport=async request=>{
   const endpoint=endpoints.find(e=>e.url===request.url);assert.ok(endpoint);assert.ok(!activeByEndpoint.has(endpoint.id),'same endpoint sends overlapped');activeByEndpoint.add(endpoint.id);active++;peak=Math.max(peak,active);
   const body=JSON.parse(request.body);assert.equal(request.headers[WEBHOOK_DELIVERY_ID_HEADER],body.id);assert.equal(verifyRawBody(request.body,request.headers[WEBHOOK_SIGNATURE_HEADER],endpoint.secret).valid,true);calls.push({endpoint:endpoint.id,body});
   await new Promise(r=>setTimeout(r,5));active--;activeByEndpoint.delete(endpoint.id);return{statusCode:200,body:'ok'};
  };
  const result=await measure('webhooks-80-'+name,()=>implementation.webhooks.runDispatchPass(pool,transport,config));assert.deepEqual(result,{createdCount:80,attemptedCount:80});
  for(const endpoint of endpoints){assert.deepEqual(calls.filter(c=>c.endpoint===endpoint.id).map(c=>c.body.id),dueOrder.filter(r=>r.endpoint_id===endpoint.id).map(r=>r.delivery_event_id));}
  const normalized=calls.map(c=>({endpoint:c.endpoint,...c.body,id:'generated'})).sort((a,b)=>(a.endpoint+a.data.transactionId).localeCompare(b.endpoint+b.data.transactionId));
  if(name==='before')webhookExpected=normalized;else assert.deepEqual(normalized,webhookExpected);
  report['webhookPeakConcurrency'+name]=peak;assert.ok(peak<=(name==='before'?1:4));
  assert.deepEqual(await implementation.webhooks.runDispatchPass(pool,transport,config),{createdCount:0,attemptedCount:0});
  const states=(await pool.query('SELECT status,attempt_count FROM webhook_deliveries WHERE endpoint_id=ANY($1::uuid[])',[endpoints.map(e=>e.id)])).rows;assert.equal(states.length,80);assert.ok(states.every(r=>r.status==='succeeded'&&r.attempt_count===1));
  dueOrder=null;
 }
 await pool.query('DELETE FROM webhook_deliveries WHERE endpoint_id=ANY($1::uuid[])',[endpoints.map(e=>e.id)]);
 let pausedCalls=0;
 await after.webhooks.runDispatchPass(pool,async request=>{if(request.url===endpoints[0].url){pausedCalls++;await pool.query("UPDATE webhook_endpoints SET status='disabled' WHERE id=$1",[endpoints[0].id]);}return{statusCode:200,body:''};},config);
 assert.equal(pausedCalls,1);
 pass('80 webhook payloads/signatures/states match; each endpoint keeps selected queue order, concurrency is bounded and pause stops subsequent sends');
 console.log('All comparative capacity checks passed.');
 if(process.env.CAPACITY_REPORT){mkdirSync(dirname(process.env.CAPACITY_REPORT),{recursive:true});writeFileSync(process.env.CAPACITY_REPORT,JSON.stringify(report,null,2)+'\n');}
}finally{pg.Client.prototype.query=query;await pool.end();}
