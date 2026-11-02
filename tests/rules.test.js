// 실행: node tests/rules.test.js
// 원고 내용이 아닌, 규칙 확인용 예문만 들어 있습니다.
const R = require('../js/rules.js');
let fail = 0, pass = 0;

function apply(text, issue) {
  return text.slice(0, issue.start) + issue.suggestion + text.slice(issue.end);
}

// [원문, 기대하는 결과(해당 규칙의 제안을 적용한 뒤), 규칙 id]
const SHOULD_FIX = [
  ['오늘이 몇일이지?', '오늘이 며칠이지?', 'myeochil'],
  ['이제 어떻해요.', '이제 어떡해요.', 'eotteokhae'],
  ['왠일이니.', '웬일이니.', 'wen'],
  ['웬지 슬펐다.', '왠지 슬펐다.', 'waenji'],
  ['금새 잊었다.', '금세 잊었다.', 'geumse'],
  ['그러면 안되요.', '그러면 안돼요.', 'dwaeyo'],
  ['잘 되서 다행이다.', '잘 돼서 다행이다.', 'dwaeseo'],
  ['꼭 가야 되.', '꼭 가야 돼.', 'doe-end'],
  ['일이 잘 됬다.', '일이 잘 됐다.', 'dwaetda'],
  ['그렇게 돼면 좋겠다.', '그렇게 되면 좋겠다.', 'dwae2doe'],
  ['밥을 않 먹었다.', '밥을 안 먹었다.', 'anh2an'],
  ['공부를 않했다.', '공부를 안 했다.', 'anh2an'],
  ['그는 가지 안았다.', '그는 가지 않았다.', 'an2anh'],
  ['그는 좋은 사람이였다.', '그는 좋은 사람이었다.', 'ieot'],
  ['이건 내 책이예요.', '이건 내 책이에요.', 'ieyo'],
  ['내가 할께요.', '내가 할게요.', 'halge'],
  ['먹을께.', '먹을게.', 'halge'],
  ['꼭 메모를 남길께요!', '꼭 메모를 남길게요!', 'halge'],
  ['내일 갈꺼야.', '내일 갈거야.', 'halgeo'],
  ['그걸 할려고 했다.', '그걸 하려고 했다.', 'ryeogo'],
  ['밥을 먹을려면 손부터 씻어.', '밥을 먹으려면 손부터 씻어.', 'ryeogo'],
  ['운동을 함으로서 건강해졌다.', '운동을 함으로써 건강해졌다.', 'eurosseo'],
  ['엄마로써 부끄러웠다.', '엄마로서 부끄러웠다.', 'roseo'],
  ['오랫만이야.', '오랜만이야.', 'oraenman'],
  ['가던지 말던지 하라.', '가든지 말든지 하라.', 'deunji'],
  ['너무 설레임이 컸다.', '너무 설렘이 컸다.', 'seollem'],
  ['문을 잠궜다.', '문을 잠갔다.', 'jamga1'],
  ['나는 할수 있다.', '나는 할 수 있다.', 'sp-su'],
  ['나는 할수있다.', '나는 할 수 있다.', 'sp-su'],
  ['나는 할 수있다.', '나는 할 수 있다.', 'sp-su2'],
  ['갈수밖에 없었다.', '갈 수밖에 없었다.', 'sp-su'],
  ['먹는것이 좋다.', '먹는 것이 좋다.', 'sp-geot'],
  ['그건 할것이다.', '그건 할 것이다.', 'sp-geot'],
  ['먹을만큼 먹어.', '먹을 만큼 먹어.', 'sp-mankeum'],
  ['웃을뿐이었다.', '웃을 뿐이었다.', 'sp-ppun'],
  ['다 아는듯 웃었다.', '다 아는 듯 웃었다.', 'sp-deut'],
  ['너때문에 웃었다.', '너 때문에 웃었다.', 'sp-ttaemun'],
  ['그렇기때문에 갔다.', '그렇기 때문에 갔다.', 'sp-ttaemun'],
  ['정말 좋다 .', '정말 좋다.', 'pu-space-before'],
  ['좋다.그래서 갔다.', '좋다. 그래서 갔다.', 'pu-space-after'],
  ['나는  갔다.', '나는 갔다.', 'pu-multispace'],
  ['끝났다..', '끝났다.', 'pu-double-period'],
  ['정말?.', '정말?', 'pu-q-period'],
  ['그 장면이 보여졌다.', '그 장면이 보였다.', 'double-passive'],
  ['이름이 잊혀진 사람', '이름이 잊힌 사람', 'double-passive'],
  ['그렇게 생각되어진다.', '그렇게 생각된다.', 'double-passive'],
  ['메세지를 보냈다.', '메시지를 보냈다.', 'term-loan'],
  ['컨텐츠가 많다.', '콘텐츠가 많다.', 'term-loan'],
];

// 맞는 문장 — 아무 '고칠 말'도 나오면 안 됨 (style 참고는 허용)
const SHOULD_NOT_FLAG = [
  '갈수록 좋아진다.',
  '되도록 빨리 와.',
  '돼지고기를 먹었다.',
  '그렇지 않나요?',
  '하지 않아도 된다.',
  '아이였다.',
  '친구였다.',
  '그게 나예요.',
  '아이예요.',
  '이것과 그것을 골랐다.',
  '아무것도 몰랐다.',
  '날것을 먹었다.',
  '비가 오는데 우산이 없다.',
  '너만큼 좋은 사람은 없다.',
  '하늘만큼 땅만큼.',
  '마을만큼 큰 나무.',
  '나뿐이다.',
  '물 쓰듯 돈을 쓴다.',
  '할 수 있다.',
  '먹을 것이다.',
  '불을 꺼야 해.',
  '살려고 애썼다.',
  '사진을 올려고 했다.',
  '말수가 적다.',
  '가방을 메고 갔다.',
  '그 일이 잘되면 좋겠다.',
  '나는 왠지 슬펐다.',
  '웬일이야.',
  '며칠 동안 비가 왔다.',
  '몇 가지 일이 남았다.',
  '그는 선생님께 갔다.',
  '부모님들께 감사드린다.',
  '여러분들께.',
  '이 책을 딸께 바친다.',
  '오래간만에 만났다.',
  '말을 걸었다.',
  '1.5배 늘었다.',
  '그녀는 "안녕"이라고 말했다.',
  '“좋아.” 그가 말했다.',
  '자리에서 일어나 그는…… 웃었다.',
  '알려진 사실이다.',
  '밝혀진 진실.',
  '돼도 그만, 안 돼도 그만.',
  '문을 닫았다.',
];

// 맞는 문장이지만 문맥상 헷갈릴 수 있어 '확인 필요'까지는 괜찮음 — '고치기 권장'은 나오면 안 됨
const NO_ERROR = ['빛이 바랬다.', '시인만큼 말을 잘한다.', '일본만큼 가깝다.', '아기를 안지 안고 걸었다.'];
for (const src of NO_ERROR) {
  const issues = R.check(src, {}).filter(i => i.level === 'error');
  if (!issues.length) pass++;
  else { fail++; console.log('✗ 확실한 오류로 지적하면 안 됨', JSON.stringify(src), issues.map(i => i.ruleId).join(',')); }
}

for (const [src, want, id] of SHOULD_FIX) {
  const issues = R.check(src, {}).filter(i => i.ruleId === id && i.suggestion !== null);
  const got = issues.length ? apply(src, issues[0]) : '(지적 없음)';
  if (got === want) pass++;
  else { fail++; console.log('✗ 고쳐야 함 [' + id + ']', JSON.stringify(src), '→', JSON.stringify(got), '기대:', JSON.stringify(want)); }
}

for (const src of SHOULD_NOT_FLAG) {
  const issues = R.check(src, {}).filter(i => i.level !== 'style');
  if (!issues.length) pass++;
  else { fail++; console.log('✗ 지적하면 안 됨', JSON.stringify(src), issues.map(i => i.ruleId + ':' + JSON.stringify(i.original) + '→' + JSON.stringify(i.suggestion)).join(', ')); }
}

// 따옴표 짝
(function () {
  const a = R.check('그는 “안녕이라고 말했다.', {}).filter(i => i.ruleId === 'pu-quote');
  const b = R.check('그는 “안녕”이라고 말했다.', {}).filter(i => i.ruleId === 'pu-quote');
  const c = R.check('그는 "안녕이라고 말했다.', {}).filter(i => i.ruleId === 'pu-quote');
  if (a.length === 1 && b.length === 0 && c.length === 1) pass++; else { fail++; console.log('✗ 따옴표 짝', a.length, b.length, c.length); }
})();

// 말줄임표 통일
(function () {
  const texts = ['그래서…… 갔다. 아니…… 아니다. 그런데... 왔다.'];
  const dom = R.dominantStyles(texts);
  const iss = R.check(texts[0], { ellipsis: dom.ellipsis }).filter(i => i.ruleId === 'pu-ellipsis');
  if (dom.ellipsis === '……' && iss.length === 1 && iss[0].original === '...' && iss[0].suggestion === '……') pass++;
  else { fail++; console.log('✗ 말줄임표 통일', dom, iss); }
})();

// 윤문: 긴 문장, 반복, 번역투
(function () {
  const long = '나는 어제 아침 일찍 일어나서 창문을 열고 밖을 내다보았는데 비가 내리고 있어서 우산을 챙겨 들고 집을 나섰지만 버스 정류장에 도착했을 때는 이미 버스가 떠나 버려서 한참을 기다려야 했다.';
  const l = R.check(long, { longSentence: 80 }).filter(i => i.ruleId === 'long-sentence');
  const rep = R.check('바다를 보았다. 바다는 넓었다. 바다가 좋았다.', { repeatMin: 3 }).filter(i => i.ruleId === 'word-repeat');
  const tr = R.check('인생에 있어서 중요한 것은 사랑하는 것이다.', {}).map(i => i.ruleId);
  const gaj = R.check('나는 음악에 관심을 가지고 있다.', {}).map(i => i.ruleId);
  const end = R.check('밥을 먹었다. 물을 마셨다. 잠을 잤다. 꿈을 꾸었다.', {}).filter(i => i.ruleId === 'ending-repeat');
  const ok = l.length === 1 && rep.length === 2 && tr.includes('tr-eitsseo') && tr.includes('tr-geosida') && gaj.includes('tr-gajida');
  if (ok) pass++; else { fail++; console.log('✗ 윤문', l.length, rep.length, tr, gaj); }
  // '었다/셨다/잤다' 처럼 끝 두 글자가 달라 반복이 아님
  if (end.length === 0) pass++; else { fail++; console.log('✗ 끝맺음 오탐', end); }
  const end2 = R.check('밥을 먹었다. 물을 먹었다. 약을 먹었다.', {}).filter(i => i.ruleId === 'ending-repeat');
  if (end2.length === 1) pass++; else { fail++; console.log('✗ 끝맺음 반복', end2); }
})();

// 사용자 표기 사전
(function () {
  const dict = [{ right: '도스토옙스키', wrongs: '도스토예프스키, 도스또옙스키' }, { right: '김철수', wrongs: '철수' }];
  const iss = R.check('도스토예프스키를 읽었다. 김철수는 웃었다. 철수가 말했다.', { dictionary: dict, useLoanwords: false }).filter(i => i.ruleId === 'term-user');
  if (iss.length === 2 && iss[0].suggestion === '도스토옙스키' && iss[1].original === '철수' && iss[1].start > 20) pass++;
  else { fail++; console.log('✗ 표기 사전', iss); }
})();

// 규칙 끄기
(function () {
  const iss = R.check('몇일', { disabledRules: { myeochil: true } });
  if (!iss.length) pass++; else { fail++; console.log('✗ 규칙 끄기', iss); }
})();

console.log(`\n통과 ${pass}개, 실패 ${fail}개`);
process.exit(fail ? 1 : 0);
