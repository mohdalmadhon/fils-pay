import assert from 'node:assert/strict';import pg from 'pg';
import {createCreditRequest} from '../../apps/api/src/admin/credits.ts';
import {settlementFeeFils} from '../../apps/api/src/fees/settlementFee.ts';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const a=(await pool.query("INSERT INTO admin_users(email,display_name,role,password_hash) VALUES($1,'audit15','finance','synthetic') RETURNING id",[crypto.randomUUID()+'@audit15.test'])).rows[0].id;
 const m=(await pool.query("INSERT INTO merchants(display_name,mdr_bps,negotiated_discount_bps) VALUES('audit15',245,1250) RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO fee_schedules(merchant_id,mdr_bps,effective_from) VALUES($1,225,now()-interval '1 day')",[m]);
 const bonus=Number((await pool.query('SELECT total_processed_fils FROM platform_stats WHERE id=1')).rows[0].total_processed_fils)>=2000000000?15:0;
 const r=await createCreditRequest(pool,{merchantId:m,adminUserId:a,body:{baseAmountFils:10000,reasonCode:'correction',reverseFee:true,effectiveDate:'2026-01-01'}});
 assert.equal(r.feeReversalFils,settlementFeeFils(10000,225-bonus,1250));assert.notEqual(r.feeReversalFils,245);
 console.log('15: manual credit uses applicable 225-bps schedule plus discount/tier');
}finally{await pool.end();}
