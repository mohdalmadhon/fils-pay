import assert from 'node:assert/strict';
import pg from 'pg';
import {applyCaptureDiscountAdjustment} from '../../apps/api/src/payments/discountAdjustment.ts';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
 const m=(await pool.query("INSERT INTO merchants(display_name) VALUES ('audit06') RETURNING id")).rows[0].id;
 const t=(await pool.query("INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,acquirer_reference) VALUES($1,'captured',10000,10000,'audit06') RETURNING id",[m])).rows[0].id;
 for (const [fee,discount] of [[0,1250],[80,1250]]) await pool.query("INSERT INTO transaction_events(transaction_id,event_type,amount_fils,actor_type,metadata) VALUES($1,'partially_captured',5000,'system',$2)",[t,{feeFils:fee,negotiatedDiscountBps:discount,chargedMdrBps:fee===0?0:160}]);
 await applyCaptureDiscountAdjustment(pool,{merchantId:m,transactionId:t});
 await Promise.all([applyCaptureDiscountAdjustment(pool,{merchantId:m,transactionId:t}),applyCaptureDiscountAdjustment(pool,{merchantId:m,transactionId:t})]);
 const r=(await pool.query("SELECT count(*)::int n,sum(amount_fils)::text total FROM ledger_entries WHERE transaction_id=$1 AND direction='credit'",[t])).rows[0];
 assert.deepEqual(r,{n:1,total:'10'});
 assert.equal((await pool.query("SELECT count(*)::int n FROM transaction_events WHERE transaction_id=$1 AND metadata ? 'negotiatedDiscountAppliedFils'",[t])).rows[0].n,2);
 console.log('06: zero discount marked; concurrent replay posts one 10-fil credit');
} finally {await pool.end();}
