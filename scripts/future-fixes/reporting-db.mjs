import pg from 'pg';import {randomUUID} from 'node:crypto';
export async function reportingDb(){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const schema='verify_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 for(const table of ['outbox_events','reporting_outbox_cursor','merchant_daily_volume','merchant_payout_trends','settlement_batches','transactions','transaction_events','reporting_processed_events']){
  if((await admin.query('SELECT to_regclass($1) present',['public.'+table])).rows[0].present)await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
 }
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 return {pool,close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
