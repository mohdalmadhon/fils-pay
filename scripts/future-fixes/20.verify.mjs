import assert from 'node:assert/strict';import {derivePublicStatus} from '../../apps/api/src/paymentLinks/status.ts';
const stale=new Date(Date.now()-120000),past=new Date(Date.now()-1000),future=new Date(Date.now()+120000);
assert.equal(derivePublicStatus({status:'reserved',reservedAt:stale,expiresAt:past},60),'expired');
assert.equal(derivePublicStatus({status:'reserved',reservedAt:stale,expiresAt:future},60),'active');
assert.equal(derivePublicStatus({status:'reserved',reservedAt:new Date(),expiresAt:past},60),'processing');
assert.equal(derivePublicStatus({status:'paid',reservedAt:null,expiresAt:past},60),'paid');
console.log('20: stale reservations respect link expiry; in-flight/paid semantics preserved');
