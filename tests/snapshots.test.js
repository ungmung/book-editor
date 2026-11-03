// 실행: node tests/snapshots.test.js — 버전 비교(diff) 확인
const { diff } = require('../js/snapshots.js');
let fail = 0, pass = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('✗ ' + m); } }
const types = d => d.ops.map(o => o.type).join(',');

let d = diff('가\n나\n다', '가\n나\n다');
ok(!d.changed && types(d) === 'same,same,same', '같은 글은 바뀐 곳 없음');

d = diff('가\n나\n다', '가\n다');
ok(types(d) === 'same,del,same' && d.removed === 1, '문단 하나 지움');

d = diff('가\n다', '가\n새 문단\n다');
ok(types(d) === 'same,add,same' && d.added === 4, '문단 하나 더함: ' + types(d));

d = diff('오랫만에 바다에 갔다.', '오랜만에 바다에 갔다.');
const m = d.ops[0];
ok(m.type === 'mod' && m.parts.some(p => p.type === 'del' && p.text === '오랫만에') && m.parts.some(p => p.type === 'add' && p.text === '오랜만에') &&
  m.parts.some(p => p.type === 'same' && p.text.includes('바다에 갔다.')), '문단 안에서 바뀐 어절만 표시');

d = diff('', '첫 글');
ok(d.changed && d.added === 2, '빈 장에서 시작');

// 큰 원고 (3,000문단) 앞뒤가 같고 가운데만 바뀐 경우 빠르게
const big = Array.from({ length: 3000 }, (_, i) => '문단 ' + i + '번입니다.');
const big2 = big.slice(); big2[1500] = '고친 문단입니다.'; big2.splice(2000, 1);
const t = Date.now(); d = diff(big.join('\n'), big2.join('\n'));
ok(Date.now() - t < 500 && d.ops.filter(o => o.type === 'mod').length === 1 && d.ops.filter(o => o.type === 'del').length === 1, '큰 원고도 빠르게 비교 (' + (Date.now() - t) + 'ms)');

// 완전히 다른 큰 글 (안전장치: 통째로 지움/더함)
const other = Array.from({ length: 3000 }, (_, i) => '다른 ' + i);
d = diff(big.join('\n'), other.join('\n'));
ok(d.changed, '완전히 다른 큰 글도 멈추지 않음');

console.log(`통과 ${pass}개, 실패 ${fail}개`);
process.exit(fail ? 1 : 0);
