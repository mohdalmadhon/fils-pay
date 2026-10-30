import assert from 'node:assert/strict';import pg from 'pg';
import {createWebhookEndpoint} from '../../apps/api/src/webhooks/create.ts';
import {deleteWebhookEndpoint} from '../../apps/api/src/webhooks/cancel.ts';
import {createWebhookDeliveryArchive,readArchiveEntries} from '../../apps/api/src/webhooks/archiveReplay.ts';
import {loadConfig} from '../../apps/api/src/config.ts';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const m=(await pool.query("INSERT INTO merchants(display_name) VALUES('audit21') RETURNING id")).rows[0].id;
 const a=(await pool.query("INSERT INTO admin_users(email,display_name,role,password_hash) VALUES($1,'audit21','finance','synthetic') RETURNING id",[crypto.randomUUID()+'@audit21.test'])).rows[0].id;
 const e=await createWebhookEndpoint(pool,loadConfig(),{merchantId:m,url:'https://example.com/hook',createdByType:'merchant_api_key',createdById:crypto.randomUUID()});
 const o=(await pool.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.voided','transaction',$1,$2) RETURNING id",[crypto.randomUUID(),{merchantId:m}])).rows[0].id;
 const d=(await pool.query("INSERT INTO webhook_deliveries(endpoint_id,outbox_event_id,event_type,delivery_event_id,payload) VALUES($1,$2,'transaction.voided',$3,'{}') RETURNING id",[e.id,o,crypto.randomUUID()])).rows[0].id;
 const archive=await createWebhookDeliveryArchive(pool,{merchantId:m,endpointId:e.id,adminUserId:a,from:new Date(0),to:new Date(Date.now()+60000)});
 assert.equal(await deleteWebhookEndpoint(pool,{merchantId:crypto.randomUUID(),id:e.id}),'not_found');
 assert.equal(await deleteWebhookEndpoint(pool,{merchantId:m,id:e.id}),'deleted');
 assert.equal((await pool.query('SELECT endpoint_id FROM webhook_deliveries WHERE id=$1',[d])).rows[0].endpoint_id,null);
 assert.equal((await pool.query('SELECT endpoint_id FROM webhook_delivery_archives WHERE id=$1',[archive.archiveId])).rows[0].endpoint_id,null);
 assert.equal((await readArchiveEntries(pool,{merchantId:m,archiveId:archive.archiveId})).length,1);
 console.log('21: endpoint deleted; delivery and readable archive retained; ownership enforced');
}finally{await pool.end();}
