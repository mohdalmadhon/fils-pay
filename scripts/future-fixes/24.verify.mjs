import assert from 'node:assert/strict';import pg from 'pg';
import {bulkApproveMerchantsKyc} from '../../apps/api/src/admin/bulkKyc.ts';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const a=(await pool.query("INSERT INTO admin_users(email,display_name,role,password_hash) VALUES($1,'audit24','finance','synthetic') RETURNING id",[crypto.randomUUID()+'@audit24.test'])).rows[0].id;
 const ids=[];
 for (const status of ['under_review','approved','rejected','submitted']) ids.push((await pool.query("INSERT INTO merchants(display_name,onboarding_status) VALUES('audit24',$1) RETURNING id",[status])).rows[0].id);
 const results=await Promise.all([bulkApproveMerchantsKyc(pool,{merchantIds:ids,adminUserId:a}),bulkApproveMerchantsKyc(pool,{merchantIds:ids,adminUserId:a})]);
 assert.equal(results.reduce((s,r)=>s+r.approvedCount,0),1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM merchant_kyc_reviews WHERE merchant_id=ANY($1::uuid[])',[ids])).rows[0].n,1);
 assert.equal((await pool.query('SELECT onboarding_status FROM merchants WHERE id=$1',[ids[2]])).rows[0].onboarding_status,'rejected');
 assert.equal((await pool.query('SELECT onboarding_status FROM merchants WHERE id=$1',[ids[3]])).rows[0].onboarding_status,'submitted');
 console.log('24: concurrent bulk approval changes only review-queue rows and writes one review');
}finally{await pool.end();}
