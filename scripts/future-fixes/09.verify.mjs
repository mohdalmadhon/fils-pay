import assert from 'node:assert/strict';import pg from 'pg';
import {captureTransaction} from '../../apps/api/src/payments/capture.ts';
import {applyCaptureDiscountAdjustment} from '../../apps/api/src/payments/discountAdjustment.ts';
import {goProbe} from './go-probe.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const m=(await pool.query("INSERT INTO merchants(display_name,mdr_bps,negotiated_discount_bps,onboarding_status) VALUES('audit09',250,1250,'approved') RETURNING id")).rows[0].id;
 const t=(await pool.query("INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,acquirer_reference) VALUES($1,'authorized',21,0,'audit09') RETURNING id",[m])).rows[0].id;
 await captureTransaction(pool,{capture:async()=>({outcome:'approved',acquirerReference:'audit09'})},{merchantId:m,transactionId:t,idempotencyKey:crypto.randomUUID(),actor:{type:'system',id:m}});
 await applyCaptureDiscountAdjustment(pool,{merchantId:m,transactionId:t});
 const r=(await pool.query("SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_fils ELSE -amount_fils END),0)::text fee FROM ledger_entries WHERE transaction_id=$1 AND account_id='platform_fee_revenue'",[t])).rows[0];assert.equal(r.fee,'0');
 goProbe(`package main
import("fmt";s "github.com/filspay/settlement/internal/settlement")
func main(){if s.ComputeSettlementFee(21,250,1250)!=0{panic("settlement differs")};fmt.Println("09: 21-fil capture and Go settlement both charge zero")}`);
}finally{await pool.end();}
