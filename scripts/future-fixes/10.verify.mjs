import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {runConsumerPass} from '../../apps/reporting/src/consumer/runConsumerPass.ts';
import {reportingDb} from './reporting-db.mjs';
const db=await reportingDb();let slow;
try{
 const m=randomUUID();slow=await db.pool.connect();await slow.query('BEGIN');
 const insert=(client,amount)=>client.query("INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('transaction.captured','transaction',$1,$2) RETURNING id",[randomUUID(),{merchantId:m,amountCapturedFils:amount}]);
 const low=(await insert(slow,10)).rows[0].id;await insert(db.pool,20);
 assert.equal((await runConsumerPass(db.pool,{consumerBatchLimit:500})).processedCount,1);
 await slow.query('COMMIT');
 assert.equal((await runConsumerPass(db.pool,{consumerBatchLimit:500})).processedCount,1);
 assert.equal((await runConsumerPass(db.pool,{consumerBatchLimit:500})).processedCount,0);
 const r=(await db.pool.query('SELECT captured_count,captured_gross_fils::text gross FROM merchant_daily_volume WHERE merchant_id=$1',[m])).rows[0];assert.equal(r.captured_count,2);assert.equal(r.gross,'30');
 console.log('10: late lower ID '+low+' consumed once after higher ID');
}finally{if(slow){await slow.query('ROLLBACK');slow.release();}await db.close();}
