import assert from 'node:assert/strict';import {bhd} from '../../apps/web/src/format.ts';
assert.match(bhd(-1),/-0\.001/);assert.match(bhd(0),/0\.000/);assert.match(bhd(4755),/4\.755/);assert.throws(()=>bhd(0.5));
console.log('19: negative balances format safely; non-integer money still rejected');
