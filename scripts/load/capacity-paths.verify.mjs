#!/usr/bin/env node
/**
 * Compare capacity changes with a prior checkout on identical fixtures.
 * WRITES fixture rows: use a disposable, migrated database, never production.
 * DATABASE_URL=... CAPACITY_FIXTURE_DB=1 BASELINE_API_SOURCE=/path/to/baseline/apps/api \
 *   node --import tsx scripts/load/capacity-paths.verify.mjs
 * Report: CAPACITY_REPORT (optional). Baseline defaults to current code.
 * Query counts exclude fixture setup and include BEGIN/COMMIT for bulk KYC.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

if (process.env.CAPACITY_FIXTURE_DB !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Set DATABASE_URL to a disposable migrated DB and CAPACITY_FIXTURE_DB=1 (writes fixtures).');
}
const currentRoot = resolve('apps/api');
const baselineRoot = resolve(process.env.BASELINE_API_SOURCE ?? currentRoot);
async function load(root, name) {
  return import(pathToFileURL(resolve(root, 'src', name + '.ts')).href);
}
const before = {
  ...(await load(baselineRoot, 'admin/bulkKyc')),
  ...(await load(baselineRoot, 'admin/transactionStatusRecompute')),
  ...(await load(baselineRoot, 'transactions/exportCsv')),
  ...(await load(baselineRoot, 'payments/capture')),
};
const after = {
  ...(await load(currentRoot, 'admin/bulkKyc')),
  ...(await load(currentRoot, 'admin/transactionStatusRecompute')),
  ...(await load(currentRoot, 'transactions/exportCsv')),
  ...(await load(currentRoot, 'payments/capture')),
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const report = { baseline: baselineRoot, checks: [], measurements: [] };
let measuring = false, queryCount = 0, rejectAudit = false;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '';
  if (measuring) queryCount++;
  if (rejectAudit && sql.includes('INSERT INTO admin_audit_log')) {
    rejectAudit = false;
    return Promise.reject(new Error('capacity verification: forced audit failure'));
  }
  return originalQuery.apply(this, args);
};
function pass(message) { report.checks.push(message); console.log('PASS', message); }
async function measure(name, setup, operation) {
  const samples = [];
  for (let i = 0; i < 7; i++) {
    await setup();
    queryCount = 0;
    const started = performance.now();
    measuring = true;
    let value;
    try { value = await operation(); } finally { measuring = false; }
    const sample = { ms: performance.now() - started, queries: queryCount };
    if (i > 0) samples.push(sample); // warm up once
  }
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const result = { name, medianMs: +((times[2] + times[3]) / 2).toFixed(3), queries: [...new Set(samples.map(s => s.queries))], samples };
  report.measurements.push(result);
  console.log(JSON.stringify({ ...result, samples: undefined }));
}
try {
  const admin = (await pool.query("SELECT id, email FROM admin_users WHERE role IN ('finance', 'super_admin') ORDER BY id LIMIT 1")).rows[0];
  assert.ok(admin, 'seed a finance admin first');
  const ids = (await pool.query("INSERT INTO merchants(display_name, onboarding_status) SELECT 'Capacity KYC '||gen_random_uuid(), 'under_review' FROM generate_series(1,200) RETURNING id")).rows.map(r => r.id).sort();
  const input = { merchantIds: ids, adminUserId: admin.id, notes: 'Capacity review "quoted"\nnotes' };
  async function resetKyc() {
    await pool.query('DELETE FROM merchant_kyc_reviews WHERE merchant_id = ANY($1::uuid[])', [ids]);
    await pool.query("UPDATE merchants SET onboarding_status='under_review', kyc_passed=false WHERE id = ANY($1::uuid[])", [ids]);
  }
  async function approve(implementation) {
    const result = await implementation.bulkApproveMerchantsKyc(pool, input);
    assert.deepEqual(result, { approvedCount: 200, approvedMerchantIds: ids });
    return result;
  }
  await measure('kyc-200-before', resetKyc, () => approve(before));
  await measure('kyc-200-after', resetKyc, () => approve(after));
  const reviews = (await pool.query('SELECT * FROM merchant_kyc_reviews WHERE merchant_id = ANY($1::uuid[])', [ids])).rows;
  assert.equal(reviews.length, 200);
  assert.ok(reviews.every(r => r.outcome === 'approved' && r.reviewer_identifier === admin.email && r.reviewer_admin_user_id === admin.id && r.notes === input.notes));
  const audited = (await pool.query("SELECT metadata FROM admin_audit_log WHERE action='kyc_bulk_approve' AND metadata->>'notes'=$1 ORDER BY created_at DESC LIMIT 1", [input.notes])).rows[0].metadata;
  assert.deepEqual(audited, { requestedMerchantIds: ids, approvedMerchantIds: ids, notes: input.notes });
  pass('200 KYC reviews retain reviewer, notes, sorted response IDs and audit metadata');
  const rejected = (await pool.query("INSERT INTO merchants(display_name,onboarding_status) VALUES ('Capacity rejected','rejected') RETURNING id")).rows[0].id;
  assert.deepEqual(await after.bulkApproveMerchantsKyc(pool, { ...input, merchantIds: [ids[0], ids[0], rejected, randomUUID()] }), { approvedCount: 0, approvedMerchantIds: [] });
  await resetKyc();
  const duplicates = await after.bulkApproveMerchantsKyc(pool, { ...input, merchantIds: [ids[0], ids[0]] });
  assert.deepEqual(duplicates, { approvedCount: 1, approvedMerchantIds: [ids[0]] });
  pass('duplicate, nonexistent, already-approved and rejected KYC IDs preserve skip behavior');
  await resetKyc();
  const concurrent = await Promise.all([after.bulkApproveMerchantsKyc(pool, input), after.bulkApproveMerchantsKyc(pool, input)]);
  assert.equal(concurrent.reduce((n, r) => n + r.approvedCount, 0), 200);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM merchant_kyc_reviews WHERE merchant_id = ANY($1::uuid[])', [ids])).rows[0].n), 200);
  pass('concurrent KYC approval creates one review per merchant');
  await resetKyc();
  rejectAudit = true;
  await assert.rejects(after.bulkApproveMerchantsKyc(pool, input), /forced audit failure/);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM merchant_kyc_reviews WHERE merchant_id = ANY($1::uuid[])', [ids])).rows[0].n), 0);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM merchants WHERE id = ANY($1::uuid[]) AND onboarding_status='under_review' AND NOT kyc_passed", [ids])).rows[0].n), 200);
  pass('failed audit rolls back all KYC reviews and merchant flags');

  const merchantId = (await pool.query("INSERT INTO merchants(display_name,test_mode) VALUES ('Capacity statuses',true) RETURNING id")).rows[0].id;
  await pool.query(`INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,refunded_fils,acquirer_reference,reference)
    SELECT $1, CASE WHEN i%4=3 THEN 'partially_refunded' ELSE 'captured' END, 1000,
      CASE WHEN i%4=0 THEN 500 ELSE 1000 END,
      CASE i%4 WHEN 0 THEN 500 WHEN 1 THEN 100 WHEN 2 THEN 1000 ELSE 0 END,
      'capacity-status-'||i, i::text FROM generate_series(1,1001) i`, [merchantId]);
  await pool.query(`INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,refunded_fils,acquirer_reference,reference) VALUES
    ($1,'authorized',1000,0,0,'capacity-open','excluded'),
    ($1,'voided',1000,0,0,'capacity-void','excluded'),
    ($1,'partially_captured',1000,500,500,'capacity-unchanged','unchanged')`, [merchantId]);
  async function resetStatuses() {
    await pool.query("UPDATE transactions SET status=CASE WHEN reference::int%4=3 THEN 'partially_refunded' ELSE 'captured' END WHERE merchant_id=$1 AND reference NOT IN ('excluded','unchanged')", [merchantId]);
  }
  const client = await pool.connect();
  async function recompute(implementation) {
    await client.query('BEGIN');
    try {
      const result = await implementation.recomputeTransactionStatusesForMerchant(client, merchantId);
      assert.deepEqual(result, { merchantId, scanned: 1002, updated: 1001, openAuthorizations: 1 });
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  let beforeRows;
  try {
    await measure('statuses-1001-before', resetStatuses, () => recompute(before));
    beforeRows = (await client.query('SELECT * FROM transactions WHERE merchant_id=$1 ORDER BY id', [merchantId])).rows;
    await measure('statuses-1001-after', resetStatuses, () => recompute(after));
    assert.deepEqual((await client.query('SELECT * FROM transactions WHERE merchant_id=$1 ORDER BY id', [merchantId])).rows, beforeRows);
    const repeated = await after.recomputeTransactionStatusesForMerchant(client, merchantId);
    assert.equal(repeated.updated, 0);
    assert.equal((await client.query('SELECT test_mode FROM merchants WHERE id=$1', [merchantId])).rows[0].test_mode, true);
    pass('1001 status changes cross batch boundaries with identical persisted rows, repeat behavior and merchant flags');
    await resetStatuses();
    await client.query('BEGIN');
    await after.recomputeTransactionStatusesForMerchant(client, merchantId);
    await client.query('ROLLBACK');
    assert.equal(Number((await client.query("SELECT count(*) AS n FROM transactions WHERE merchant_id=$1 AND status=CASE WHEN reference ~ '^[0-9]+$' THEN CASE WHEN reference::int%4=3 THEN 'partially_refunded' ELSE 'captured' END END", [merchantId])).rows[0].n), 1001);
    pass('status recomputation rollback preserves every original status');
  } finally { client.release(); }

  const { authorizeTransaction } = await load(currentRoot, 'payments/authorize');
  const { recordKycReview } = await load(currentRoot, 'onboarding/review');
  const { settlementFeeFils } = await load(currentRoot, 'fees/settlementFee');
  const { getVolumeTierBonusBps } = await load(currentRoot, 'fees/platformVolumeTier');
  const acquirer = {
    async authorize() { return { outcome:'approved', acquirerReference:randomUUID(), latencyMs:0 }; },
    async capture(input) { return { outcome:'approved', acquirerReference:input.acquirerReference, latencyMs:0 }; },
  };
  const actor = { type:'system', id:null };
  const amount = 10021;
  for (const mdr of [250, 0]) {
    const captureMerchant = (await pool.query("INSERT INTO merchants(display_name,mdr_bps,negotiated_discount_bps) VALUES ('Capacity capture',$1,1000) RETURNING id", [mdr])).rows[0].id;
    await recordKycReview(pool,{merchantId:captureMerchant,outcome:'approved',reviewerIdentifier:'capacity-verification'});
    // Both versions must see an existing cache row; otherwise the first
    // capture also pays the one-off cache initialization query.
    await pool.query('INSERT INTO merchant_balances(merchant_id,cached_payable_fils,updated_at) VALUES ($1,0,now())',[captureMerchant]);
    const bonus = await getVolumeTierBonusBps(pool);
    const fee = settlementFeeFils(amount,Math.max(0,mdr-bonus),1000);
    const counts=[];
    for (const [name,implementation] of [['before',before],['after',after]]) {
      const authorization = await authorizeTransaction(pool,acquirer,{
        merchantId:captureMerchant,amountFils:amount,idempotencyKey:randomUUID(),
        card:{pan:'4242424242424242',expiryMonth:12,expiryYear:2030,cvv:'123'},
      });
      assert.equal(authorization.statusCode,201);
      const input={merchantId:captureMerchant,transactionId:authorization.body.id,idempotencyKey:randomUUID(),actor};
      queryCount=0;measuring=true;
      let captured;
      try { captured=await implementation.captureTransaction(pool,acquirer,input); }
      finally { measuring=false; }
      counts.push(queryCount);
      assert.equal(captured.statusCode,200);
      assert.equal(captured.body.capturedFils,amount);
      assert.equal(captured.body.status,'captured');
      const legs=(await pool.query('SELECT account_id,direction,amount_fils,description,entry_group_id FROM ledger_entries WHERE transaction_id=$1 ORDER BY id',[input.transactionId])).rows;
      assert.equal(legs.length,fee>0?4:2);
      assert.equal(new Set(legs.map(r=>r.entry_group_id)).size,1);
      assert.equal(legs.reduce((net,r)=>net+(r.direction==='debit'?1:-1)*Number(r.amount_fils),0),0);
      assert.deepEqual(legs.map(({entry_group_id,...r})=>r),[
        {account_id:'card_scheme_clearing',direction:'debit',amount_fils:String(amount),description:'capture: gross'},
        {account_id:'merchant_payable',direction:'credit',amount_fils:String(amount),description:'capture: gross'},
        ...(fee>0?[
          {account_id:'merchant_payable',direction:'debit',amount_fils:String(fee),description:'capture: MDR fee'},
          {account_id:'platform_fee_revenue',direction:'credit',amount_fils:String(fee),description:'capture: MDR fee'},
        ]:[]),
      ]);
      assert.deepEqual(await implementation.captureTransaction(pool,acquirer,input),captured);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id=$1',[input.transactionId])).rows[0].n,legs.length);
      const event=(await pool.query("SELECT metadata FROM transaction_events WHERE transaction_id=$1 AND event_type='captured'",[input.transactionId])).rows[0];
      assert.equal(event.metadata.feeFils,fee);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id=$1 AND event_type='transaction.captured'",[input.transactionId])).rows[0].n,1);
    }
    assert.equal(counts[0]-counts[1],fee>0?1:0);
    report.captureSql ??= [];
    report.captureSql.push({mdr,fee,before:counts[0],after:counts[1]});
  }
  pass('capture preserves exact gross/fee legs, fee snapshots, events and idempotent responses for normal and zero fees');

  const exportId = (await pool.query("INSERT INTO merchants(display_name) VALUES ('Capacity CSV') RETURNING id")).rows[0].id;
  await pool.query(`INSERT INTO transactions(merchant_id,status,amount_fils,captured_fils,reference,acquirer_reference,occurred_at)
    SELECT $1,'authorized',4755,0,
      CASE i%5 WHEN 0 THEN NULL WHEN 1 THEN '=formula' WHEN 2 THEN E'quoted,"line"\nnext' ELSE 'csv-'||i END,
      repeat('unused-acquirer-field-',25)||i, '2026-09-01T00:00Z'::timestamptz + i*interval '1 second'
      FROM generate_series(1,20000) i`, [exportId]);
  // A projection can change the sort plan and the order of timestamp ties.
  // Preserve byte-for-byte compatibility, including this existing case.
  await pool.query("UPDATE transactions SET occurred_at='2026-09-01T00:30Z' WHERE id IN (SELECT id FROM transactions WHERE merchant_id=$1 ORDER BY id LIMIT 200)",[exportId]);
  for (const filters of [ {merchantId:exportId}, {merchantId:exportId,status:['captured']}, {merchantId:exportId,status:[]}, {merchantId:exportId,from:new Date('2026-09-01T00:10Z'),to:new Date('2026-09-01T00:20Z')} ]) {
    assert.equal(await after.buildTransactionsExportCsv(pool,filters), await before.buildTransactionsExportCsv(pool,filters));
  }
  const csv=await after.buildTransactionsExportCsv(pool,{merchantId:exportId});
  report.csv={rows:20000,bytes:Buffer.byteLength(csv),sha256:createHash('sha256').update(csv).digest('hex')};
  pass('unchanged CSV bytes match the prior version for 20000 rows, tied timestamps, escaping, null references, dates and status filters');
  console.log('All capacity path checks passed.');
  if(process.env.CAPACITY_REPORT)writeFileSync(process.env.CAPACITY_REPORT,JSON.stringify(report,null,2));
} finally {
  pg.Client.prototype.query=originalQuery;
  await pool.end();
}
