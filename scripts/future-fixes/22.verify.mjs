import assert from 'node:assert/strict';
import {runDispatchPass} from '../../apps/api/src/webhooks/dispatcher.ts';
import {createWebhookEndpoint} from '../../apps/api/src/webhooks/create.ts';
import {loadConfig} from '../../apps/api/src/config.ts';
import {reportingDb} from './reporting-db.mjs';
const db=await reportingDb();const cfg=loadConfig();let sends=0;
const transport=async()=>{sends++;return {statusCode:200,body:'ok'}};
try{
 const m=crypto.randomUUID();const e=await createWebhookEndpoint(db.pool,cfg,{merchantId:m,url:'https://example.com/hook',createdByType:'merchant_api_key',createdById:crypto.randomUUID()});
 const o=(await db.pool.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.voided','transaction',$1,$2) RETURNING id",[crypto.randomUUID(),{merchantId:m}])).rows[0].id;
 const d=(await db.pool.query("INSERT INTO webhook_deliveries(endpoint_id,outbox_event_id,event_type,delivery_event_id,payload) VALUES($1,$2,'transaction.voided',$3,'{}') RETURNING id",[e.id,o,crypto.randomUUID()])).rows[0].id;
 await db.pool.query("UPDATE webhook_endpoints SET status='disabled' WHERE id=$1",[e.id]);await runDispatchPass(db.pool,transport,cfg);assert.equal(sends,0);
 assert.equal((await db.pool.query('SELECT attempt_count FROM webhook_deliveries WHERE id=$1',[d])).rows[0].attempt_count,0);
 await db.pool.query("UPDATE webhook_endpoints SET status='active' WHERE id=$1",[e.id]);await runDispatchPass(db.pool,transport,cfg);assert.equal(sends,1);
 console.log('22: disabled queue remains pending; re-enable resumes one simulated delivery');
}finally{await db.close();}
