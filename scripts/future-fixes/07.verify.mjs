import assert from 'node:assert/strict';import pg from 'pg';
import {captureTransaction} from '../../apps/api/src/payments/capture.ts';
import {goProbe} from './go-probe.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
 const m=(await pool.query("INSERT INTO merchants(display_name,mdr_bps,onboarding_status) VALUES('audit07',225,'approved') RETURNING id")).rows[0].id;
 const t=(await pool.query("INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,acquirer_reference) VALUES($1,'authorized',10000,0,'audit07') RETURNING id",[m])).rows[0].id;
 const result=await captureTransaction(pool,{capture:async()=>({outcome:'approved',acquirerReference:'audit07'})},{merchantId:m,transactionId:t,idempotencyKey:crypto.randomUUID(),actor:{type:'system',id:m}});
 assert.equal(result.statusCode,200);
 assert.equal(Number((await pool.query('SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id=$1',[m])).rows[0].cached_payable_fils),9775);
 goProbe(`package main
import("context";"os";"fmt";"time";"github.com/google/uuid";"github.com/jackc/pgx/v5/pgxpool";s "github.com/filspay/settlement/internal/settlement";l "github.com/filspay/settlement/internal/ledger")
func main(){ctx:=context.Background();db,e:=pgxpool.New(ctx,os.Getenv("DATABASE_URL"));if e!=nil{panic(e)};defer db.Close();m:=uuid.MustParse("${m}")
if _,e=l.RebuildAllBalances(ctx,db);e!=nil{panic(e)};b,e:=s.CloseBatch(ctx,db,m,s.BusinessDateAt(time.Now()));if e!=nil{panic(e)}
var n int64;db.QueryRow(ctx,"SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id=$1",m).Scan(&n);if n!=9775{panic(fmt.Sprint("close double counted: ",n))}
if _,e=s.PayoutBatch(ctx,db,b.BatchID);e!=nil{panic(e)};db.QueryRow(ctx,"SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id=$1",m).Scan(&n);if n!=0{panic(fmt.Sprint("paid balance: ",n))};fmt.Println("07: capture/rebuild/close/pay cache equals ledger")}
`);
}finally{await pool.end();}
