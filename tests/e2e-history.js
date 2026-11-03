// 버전 기록 확인: python3 -m http.server 8765 를 띄운 뒤 node tests/e2e-history.js
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8765/index.html';
const SHOT = process.env.SHOT_DIR;
let fails = 0;
function ok(c, m) { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; }

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept('출판사 보내기 전'); else await d.accept(); });
  const idx = () => page.evaluate(() => Snapshots.index.map(m => m.reason + ':' + m.label));
  const setText = async (t) => {
    await page.evaluate((t) => { const e = document.getElementById('editor'); e.value = t; e.dispatchEvent(new Event('input')); }, t);
    await page.evaluate(() => window.__bookEditor.saveNow());
    await page.waitForTimeout(150);
  };

  await page.goto(URL);
  await page.click('#helpDlg button[value=close]');
  ok((await idx()).length === 0, '빈 원고로 처음 열면 기록을 남기지 않음');

  // 1. 직접 저장
  await setText('오랫만에 바다에 갔다.\n파도가 높았다.');
  await page.click('#openHistory');
  await page.fill('#snapName', '초고');
  await page.click('#snapNow');
  await page.waitForTimeout(300);
  ok((await idx())[0] === 'manual:초고', '이름 붙여 지금 버전 저장');
  ok((await page.textContent('#snapDetail')).includes('똑같아요'), '방금 저장한 버전은 지금과 같다고 표시');
  await page.click('#historyDlg button[value=close]');

  // 2. 고친 뒤 비교
  await setText('오랜만에 바다에 갔다.\n파도가 높았다.\n모래사장을 걸었다.');
  await page.click('#openHistory');
  await page.waitForTimeout(300);
  const del = await page.locator('#snapDetail .diff .d-del').allTextContents();
  const add = await page.locator('#snapDetail .diff .d-add').allTextContents();
  ok(del.includes('오랫만에') && add.includes('오랜만에') && add.includes('모래사장을 걸었다.'), '비교: 지운 어절·새로 쓴 어절과 문단 표시');
  ok((await page.textContent('#snapDetail .diff-legend')).includes('더한 글'), '더한 글자·지운 글자 수 표시');
  if (SHOT) await page.screenshot({ path: SHOT + '/11-history-diff.png' });

  // 3. 이 장 되돌리기 → 되돌리기 전 상태가 자동 기록 → 다시 되돌아갈 수 있음
  await page.click('[data-sa=restoreCh]');
  await page.waitForTimeout(400);
  ok((await page.inputValue('#editor')) === '오랫만에 바다에 갔다.\n파도가 높았다.', '이 장을 예전 버전으로 되돌림');
  ok((await idx())[0].startsWith('before:') && (await idx())[0].includes('되돌리기 전'), '되돌리기 직전 상태를 자동 기록');
  await page.click('#snapList .snap-item >> nth=0');
  await page.waitForTimeout(300);
  await page.click('[data-sa=restoreCh]');
  await page.waitForTimeout(400);
  ok((await page.inputValue('#editor')).includes('모래사장을 걸었다.'), '되돌린 것을 다시 되돌릴 수 있음');
  await page.click('#historyDlg button[value=close]');

  // 4. 장 삭제 → 기록에서 되살리기
  await page.click('#addChapter');
  await page.fill('#docTitle', '2장 산');
  await setText('산에 올랐다.');
  const before = (await idx()).length;
  await page.click('#deleteDoc');
  await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => window.__bookEditor.state.chapters.some(c => c.title === '2장 산'))), '장 삭제');
  ok((await idx()).length === before + 1 && (await idx())[0].includes('2장 산'), '삭제 직전 상태를 자동 기록');
  await page.click('#openHistory');
  await page.waitForTimeout(300);
  const optText = await page.locator('#snapCh option:checked').textContent();
  ok(optText.includes('2장 산') && optText.includes('지금은 없음'), '지운 장을 "지금은 없음"으로 표시: ' + optText);
  await page.click('[data-sa=restoreCh]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => window.__bookEditor.state.chapters.some(c => c.title === '2장 산' && c.text === '산에 올랐다.')), '지운 장 되살리기');
  await page.click('#historyDlg button[value=close]');

  // 5. 원고 전체 되돌리기 (첫 기록 '초고' 시점: 장 하나)
  await page.click('#openHistory');
  await page.waitForTimeout(200);
  const last = page.locator('#snapList .snap-item').last();
  await last.click();
  await page.waitForTimeout(300);
  await page.click('[data-sa=restoreAll]');
  await page.waitForTimeout(500);
  const chs = await page.evaluate(() => window.__bookEditor.state.chapters.map(c => c.title + '|' + c.text));
  ok(chs.length === 1 && chs[0] === '1장|오랫만에 바다에 갔다.\n파도가 높았다.', '원고 전체를 예전 버전으로 되돌림');
  ok((await idx())[0].includes('원고 전체 되돌리기 전'), '전체 되돌리기 직전 상태도 기록');

  // 6. 이름 붙여 보관
  await page.click('#snapList .snap-item >> nth=0');
  await page.waitForTimeout(200);
  await page.click('[data-sa=rename]');
  await page.waitForTimeout(200);
  ok((await idx())[0] === 'manual:출판사 보내기 전', '자동 기록에 이름 붙여 오래 보관');

  // 7. 기록 지우기
  const n7 = (await idx()).length;
  await page.click('[data-sa=delete]');
  await page.waitForTimeout(300);
  ok((await idx()).length === n7 - 1, '기록 지우기');
  await page.click('#historyDlg button[value=close]');

  // 8. 30분마다 자동 기록
  await page.evaluate(() => { Snapshots.index[0].time -= 31 * 60 * 1000; });
  const n8 = (await idx()).length;
  await setText('오랫만에 바다에 갔다.\n파도가 높았다.\n자동 기록 시험.');
  await page.waitForTimeout(300);
  ok((await idx()).length === n8 + 1 && (await idx())[0].startsWith('auto:'), '30분 지나면 저장할 때 자동 기록');
  await setText('오랫만에 바다에 갔다.\n파도가 높았다.\n자동 기록 시험. 한 줄 더.');
  ok((await idx()).length === n8 + 1, '30분 안에는 또 기록하지 않음');

  // 9. 새로고침해도 기록 유지, 바뀐 게 있으면 '열 때' 기록
  const n9 = (await idx()).length;
  await page.reload();
  await page.waitForTimeout(600);
  ok((await idx()).length === n9 + 1 && (await idx())[0].startsWith('open:'), '새로고침해도 기록 유지 + 열 때 기록');
  await page.reload();
  await page.waitForTimeout(600);
  ok((await idx()).length === n9 + 1, '바뀐 게 없으면 열 때 또 기록하지 않음');

  ok(errors.length === 0, '자바스크립트 오류 없음' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // 10. 휴대폰 화면
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await phone.goto(URL);
  await phone.click('#helpDlg button[value=close]');
  await phone.evaluate(() => { const e = document.getElementById('editor'); e.value = '휴대폰 메모.'; e.dispatchEvent(new Event('input')); return window.__bookEditor.saveNow(); });
  await phone.click('#openHistory');
  await phone.click('#snapNow');
  await phone.evaluate(() => { const e = document.getElementById('editor'); e.value = '휴대폰 메모를 고쳤다.'; e.dispatchEvent(new Event('input')); });
  await phone.click('#historyDlg button[value=close]');
  await phone.click('#openHistory');
  await phone.waitForTimeout(300);
  if (SHOT) await phone.screenshot({ path: SHOT + '/12-history-phone.png' });
  ok(!(await phone.evaluate(() => document.querySelector('#historyDlg').scrollWidth > document.querySelector('#historyDlg').clientWidth + 1)), '휴대폰: 버전 기록 창이 가로로 넘치지 않음');

  await browser.close();
  console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
