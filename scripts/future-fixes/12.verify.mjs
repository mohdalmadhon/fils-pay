import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {refreshAnalyticsRollups} from '../../apps/api/src/admin/reportingRebuild.ts';
import {runConsumerPass} from '../../apps/reporting/src/consumer/runConsumerPass.ts';
import {reportingDb} from './reporting-db.mjs';
const db=await reportingDb();
try{
 const m=randomUUID();const t=(await db.pool.query("INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,acquirer_reference) VALUES($1,'captured',100,100,'audit12') RETURNING id",[m])).rows[0].id;
 await db.pool.query("INSERT INTO transaction_events(transaction_id,event_type,amount_fils,actor_type) VALUES($1,'captured',100,'system')",[t]);
 await db.pool.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.captured','transaction',$1,$2)",[t,{merchantId:m,amountCapturedFils:100}]);
 const client=await db.pool.connect();try{await client.query('BEGIN');await refreshAnalyticsRollups(client);await client.query('COMMIT');}finally{client.release();}
 assert.equal((await runConsumerPass(db.pool,{consumerBatchLimit:500})).processedCount,0);
 assert.equal((await db.pool.query('SELECT captured_gross_fils::text amount FROM merchant_daily_volume WHERE merchant_id=$1',[m])).rows[0].amount,'100');
 console.log('12: admin rebuild acknowledges included backlog; worker does not add it again');
}finally{await db.close();}
