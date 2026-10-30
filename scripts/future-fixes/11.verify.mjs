import assert from 'node:assert/strict';
import {readCursor} from '../../apps/reporting/src/consumer/cursor.ts';
import {reportingDb} from './reporting-db.mjs';
const db=await reportingDb();
try{
 await db.pool.query("INSERT INTO reporting_outbox_cursor(consumer_name,last_processed_id) VALUES('reporting',0)");
 const a=await db.pool.connect(),b=await db.pool.connect();
 try{
 await a.query('BEGIN');await b.query('BEGIN');await readCursor(a,'reporting');
 let finished=false;const second=readCursor(b,'reporting').then(r=>{finished=true;return r});
 await new Promise(r=>setTimeout(r,60));assert.equal(finished,false,'second process must wait on cursor');
 await a.query("UPDATE reporting_outbox_cursor SET last_processed_id=12 WHERE consumer_name='reporting'");await a.query('COMMIT');
 assert.equal((await second).lastProcessedId,12n);await b.query('COMMIT');console.log('11: concurrent reader waits and sees committed cursor');
 }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
}finally{await db.close();}
