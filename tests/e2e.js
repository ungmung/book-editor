// 브라우저 동작 확인: python3 -m http.server 8765 를 띄운 뒤 node tests/e2e.js [결과폴더]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', '.e2e-out');
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.URL || 'http://localhost:8765/index.html';

let fails = 0;
function ok(cond, msg) { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) fails++; }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL);
  // 처음 열면 도움말이 뜸
  ok(await page.locator('#helpDlg').evaluate(d => d.open), '처음 열면 도움말 표시');
  await page.screenshot({ path: path.join(OUT, '01-help.png') });
  await page.click('#tryDemo');
  await page.waitForTimeout(300);
  const n0 = await page.evaluate(() => window.__bookEditor.issues.length);
  ok(n0 >= 10, '예문 점검: 지적 ' + n0 + '개');
  const ids = await page.evaluate(() => window.__bookEditor.issues.map(i => i.ruleId));
  for (const id of ['oraenman', 'myeochil', 'eotteokhae', 'sp-su', 'tr-geosida', 'tr-eitsseo', 'double-passive', 'halgeo', 'halge', 'term-loan', 'pu-space-before', 'long-sentence', 'pu-ellipsis', 'word-repeat']) {
    ok(ids.includes(id), '  예문에서 찾음: ' + id);
  }
  await page.screenshot({ path: path.join(OUT, '02-demo-check.png') });

  // 하이라이트 위치 확인: '오랫만' mark가 실제 글자 위치와 같은 줄에 있어야 함
  const markBox = await page.locator('#backdrop mark').first().boundingBox();
  ok(markBox && markBox.width > 10, '원고에 색칠 표시가 보임');

  // 적용
  const before = await page.inputValue('#editor');
  await page.locator('.issue', { hasText: "'오랜만'" }).locator('[data-act=apply]').click();
  const after = await page.inputValue('#editor');
  ok(before.startsWith('오랫만') && after.startsWith('오랜만'), '적용: 오랫만 → 오랜만');
  // Ctrl+Z 되돌리기
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok((await page.inputValue('#editor')).startsWith('오랫만'), 'Ctrl+Z로 되돌리기');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(900);

  // 무시
  const cntBefore = await page.evaluate(() => window.__bookEditor.issues.length);
  await page.locator('.issue').first().locator('[data-act=ignore]').click();
  const cntAfter = await page.evaluate(() => window.__bookEditor.issues.length);
  ok(cntAfter === cntBefore - 1, '무시: 지적 하나 사라짐');
  ok((await page.textContent('#ignoredNote')).includes('무시한 지적 1개'), '무시한 지적 개수 표시');
  // 다시 점검해도 무시한 건 안 나옴
  await page.click('#runCheck');
  ok(await page.evaluate(() => window.__bookEditor.issues.length) === cntAfter, '다시 점검해도 무시한 지적은 숨김');

  // Claude에 물어보기 (복사)
  await page.locator('.issue').first().locator('[data-act=ask]').click();
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.includes('문장:') && clip.includes('교정 도구가 지적한 점'), 'Claude 질문 복사됨');

  // 카드 클릭 → 원고 해당 위치 선택
  const target = await page.evaluate(() => window.__bookEditor.issues.find(i => i.ruleId === 'term-loan'));
  await page.locator('.issue', { hasText: '외래어 표기' }).locator('.issue-title').click();
  const sel = await page.evaluate(() => [document.getElementById('editor').selectionStart, document.getElementById('editor').selectionEnd]);
  ok(sel[0] === target.start && sel[1] === target.end, '지적 카드를 누르면 원고의 그 자리가 선택됨');

  // 필터
  await page.locator('#levelFilters input[value=style]').uncheck();
  const visible = await page.locator('.issue').count();
  const nonStyle = await page.evaluate(() => window.__bookEditor.issues.filter(i => i.level !== 'style').length);
  ok(visible === nonStyle, '‘참고’ 끄면 참고 항목 숨김');
  await page.locator('#levelFilters input[value=style]').check();

  // 새 장 + 글쓰기 + 표기 사전
  await page.click('#addChapter');
  await page.fill('#docTitle', '첫 번째 이야기');
  await page.click('#editor');
  await page.keyboard.type('도스토예프스키를 읽던 밤이었다.\n두 번째 문단이다.');
  await page.click('[data-open=dictDlg]');
  await page.click('#addDict');
  await page.fill('#dictRows .dict-row:last-child input[data-f=right]', '도스토옙스키');
  await page.fill('#dictRows .dict-row:last-child input[data-f=wrongs]', '도스토예프스키, 도스또옙스키');
  await page.screenshot({ path: path.join(OUT, '03-dictionary.png') });
  await page.click('#dictDlg button[value=close]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__bookEditor.issues.some(i => i.ruleId === 'term-user' && i.suggestion === '도스토옙스키')), '표기 사전: 다르게 쓴 곳 찾음');

  const listN = await page.locator('#chapterList button[aria-current=true] .n').textContent();
  ok(listN === '27자', '왼쪽 목록의 장 글자 수 갱신: ' + listN);
  // 통계
  await page.click('.tabs [data-tab=stats]');
  const statsText = await page.textContent('#statsPanel');
  ok(statsText.includes('첫 번째 이야기') && statsText.includes('원고지'), '통계 탭: 장별 분량 표시');
  const meta = await page.textContent('#docMeta');
  ok(/공백 포함 2\d자/.test(meta), '글자 수 표시: ' + meta);
  await page.screenshot({ path: path.join(OUT, '04-stats.png') });
  await page.click('.tabs [data-tab=issues]');

  // 저장 확인 (새로고침 후 유지)
  await page.evaluate(() => window.__bookEditor.saveNow());
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForTimeout(500);
  ok(!(await page.locator('#helpDlg').evaluate(d => d.open)), '두 번째부터는 도움말이 저절로 뜨지 않음');
  ok((await page.inputValue('#editor')).includes('도스토예프스키를 읽던 밤'), '새로고침 후에도 원고 유지');
  ok((await page.evaluate(() => window.__bookEditor.state.dictionary.length)) === 1, '새로고침 후에도 표기 사전 유지');

  // 내보내기 docx / txt / json
  async function exportAs(fmt, range) {
    await page.click('[data-open=exportDlg]');
    await page.check(`#exportForm input[name=fmt][value=${fmt}]`);
    if (range) await page.check(`#exportForm input[name=range][value=${range}]`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doExport')]);
    const p = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(p);
    return p;
  }
  await page.fill('#bookTitle', '시험용 책');
  const docxPath = await exportAs('docx', 'book');
  const txtPath = await exportAs('txt', 'book');
  const jsonPath = await exportAs('json');
  ok(fs.statSync(docxPath).size > 1000, 'docx 내보내기: ' + path.basename(docxPath));
  const txt = fs.readFileSync(txtPath, 'utf8');
  ok(txt.includes('# 첫 번째 이야기') && txt.includes('도스토예프스키'), 'txt 내보내기: ' + path.basename(txtPath));
  ok(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).dictionary.length === 1, 'json 전체 백업 내보내기');

  // docx 다시 불러오기 (라운드트립)
  await page.click('[data-open=importDlg]');
  await page.setInputFiles('#importFile', docxPath);
  await page.waitForTimeout(500);
  const titles = await page.evaluate(() => window.__bookEditor.state.chapters.map(c => c.kind + ':' + c.title));
  const chs = await page.evaluate(() => window.__bookEditor.state.chapters.filter(c => c.title === '첫 번째 이야기').map(c => c.text));
  ok(chs.length === 2 && chs[0] === chs[1], 'docx 불러오기: 장 제목·본문이 그대로 돌아옴');
  // txt 불러오기 → 메모로
  await page.click('[data-open=importDlg]');
  await page.check('#importAsMemo');
  await page.setInputFiles('#importFile', txtPath);
  await page.waitForTimeout(300);
  const memoCount = await page.evaluate(() => window.__bookEditor.state.chapters.filter(c => c.kind === 'memo').length);
  ok(memoCount >= 2, 'txt를 메모로 불러오기 (메모 ' + memoCount + '개)');

  // 백업 되살리기
  page.once('dialog', d => d.accept());
  await page.click('[data-open=importDlg]');
  await page.setInputFiles('#restoreFile', jsonPath);
  await page.waitForTimeout(600);
  const afterRestore = await page.evaluate(() => window.__bookEditor.state.chapters.length);
  ok(afterRestore === JSON.parse(fs.readFileSync(jsonPath, 'utf8')).chapters.length, '백업 파일로 되살리기');

  // 설정: 긴 문장 기준 바꾸기
  await page.click('[data-open=settingsDlg]');
  await page.fill('#setLong', '30');
  await page.dispatchEvent('#setLong', 'change');
  await page.screenshot({ path: path.join(OUT, '05-settings.png') });
  await page.click('#settingsDlg button[value=close]');
  ok(await page.evaluate(() => window.__bookEditor.state.settings.longSentence) === 30, '설정 바꾸기 저장');

  ok(errors.length === 0, '자바스크립트 오류 없음' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // 휴대폰 화면
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pp = await phone.newPage();
  await pp.goto(URL);
  await pp.click('#helpDlg button[value=close]');
  await pp.click('.bottom-nav [data-view=list]');
  await pp.click('#addMemo');
  await pp.click('#editor');
  await pp.keyboard.type('휴대폰에서 쓴 메모다. 몇일 뒤에 다시 볼께.');
  await pp.waitForTimeout(1000);
  await pp.screenshot({ path: path.join(OUT, '06-phone-editor.png') });
  await pp.click('.bottom-nav [data-view=side]');
  await pp.screenshot({ path: path.join(OUT, '07-phone-issues.png') });
  const phoneIssues = await pp.locator('.issue').count();
  ok(phoneIssues >= 2, '휴대폰: 점검 화면에 지적 ' + phoneIssues + '개');
  await pp.locator('.issue', { hasText: '며칠' }).locator('[data-act=apply]').click();
  await pp.click('.bottom-nav [data-view=editor]');
  ok((await pp.inputValue('#editor')).includes('며칠'), '휴대폰: 적용 동작');
  await pp.click('.bottom-nav [data-view=list]');
  await pp.screenshot({ path: path.join(OUT, '08-phone-list.png') });
  const hscroll = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!hscroll, '휴대폰: 가로 스크롤 없음');

  // 큰 원고 성능 (약 15만 자)
  await page.click('#addChapter');
  const big = await page.evaluate(() => {
    const para = '오랫만에 바다에 갔다. 나는 할수 있다고 대답했지만 사실 자신이 없었다. 그날의 바다는 정말 아름다웠다.\n';
    const t = para.repeat(1500);
    const ed = document.getElementById('editor');
    ed.value = t; ed.dispatchEvent(new Event('input'));
    const s = performance.now(); window.__bookEditor.runCheck(); return { ms: Math.round(performance.now() - s), len: t.length, n: window.__bookEditor.issues.length };
  });
  ok(big.ms < 1500, `큰 원고 점검 속도: ${big.len.toLocaleString()}자, ${big.ms}ms, 지적 ${big.n}개`);

  await browser.close();
  console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
