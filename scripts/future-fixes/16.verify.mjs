import assert from 'node:assert/strict';
import {parseCreditRequestInput} from '../../apps/api/src/admin/creditRequestValidation.ts';
const body={baseAmountFils:1,reasonCode:'goodwill',effectiveDate:'2026-10-31'};
assert.throws(()=>parseCreditRequestInput(body,new Date('2026-10-30T20:59:59Z')),e=>e.statusCode===400&&e.code==='invalid_effective_date');
assert.equal(parseCreditRequestInput(body,new Date('2026-10-30T21:00:00Z')).effectiveDate,'2026-10-31');
assert.throws(()=>parseCreditRequestInput({...body,effectiveDate:'2099-01-01'}));
console.log('16: future credit dates rejected; Bahrain midnight boundary accepted');
