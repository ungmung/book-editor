// '원고 파일에 자동 저장' 기능 확인: python3 -m http.server 8765 를 띄운 뒤 node tests/e2e-file.js
// 실제 파일 고르기 창은 자동으로 누를 수 없어서, 브라우저 안의 가상 파일 공간(OPFS)으로 바꿔 끼워 시험한다.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8765/index.html';
let fails = 0;
function ok(c, m) { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; }

const STUB = `
  async function fileHandle(name) {
    const dir = await navigator.storage.getDirectory();
    return dir.getFileHandle(name, { create: true });
  }
  window.showSaveFilePicker = async (o) => fileHandle(o.suggestedName);
  window.showOpenFilePicker = async () => [await fileHandle(window.__openName || 'existing.json')];
  // 이 시험 환경의 Chromium은 파일 연결 정보를 IndexedDB에서 다시 읽으면 꺼진다(실제 크롬은 정상).
  // 그래서 연결 정보 보관만 '파일 이름 기억'으로 흉내 내고, 나머지 과정은 그대로 시험한다.
  let _bs;
  Object.defineProperty(window, 'BookStorage', {
    configurable: true, get() { return _bs; },
    set(v) {
      const get = v.get, set = v.set, del = v.del;
      v.get = async (k) => k === 'fileHandle' ? (localStorage.getItem('t:fh') ? fileHandle(localStorage.getItem('t:fh')) : null) : get(k);
      v.set = async (k, val) => k === 'fileHandle' ? localStorage.setItem('t:fh', val.name) : set(k, val);
      v.del = async (k) => k === 'fileHandle' ? localStorage.removeItem('t:fh') : del(k);
      _bs = v;
    }
  });
`;
async function readFile(page, name) {
  return page.evaluate(async (n) => {
    const dir = await navigator.storage.getDirectory();
    const f = await (await dir.getFileHandle(n)).getFile();
    return f.text();
  }, name);
}
async function writeFile(page, name, text) {
  await page.evaluate(async ([n, t]) => {
    const dir = await navigator.storage.getDirectory();
    const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
    await w.write(t); await w.close();
  }, [name, text]);
}
async function typeInEditor(page, text) {
  await page.click('#editor');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

  await page.goto(URL);
  await page.click('#helpDlg button[value=close]');
  await page.fill('#bookTitle', '바다 에세이');
  await typeInEditor(page, '첫 문장이다.');

  // 1. 새 원고 파일 만들기
  await page.click('#fileBtn');
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/09-file-dialog.png' : '/dev/null' }).catch(() => {});
  await page.click('#fsCreate');
  await page.waitForTimeout(400);
  const name = '바다 에세이-원고.json';
  let saved = JSON.parse(await readFile(page, name));
  ok(saved.app === 'book-editor' && saved.chapters[0].text.includes('첫 문장이다.'), '새 원고 파일 만들기: 지금 원고가 파일에 담김');
  ok((await page.textContent('#saveState')).includes(name), '위쪽에 연결된 파일 이름 표시');
  ok((await page.textContent('#fileBtn')).includes(name), '원고 파일 버튼에 파일 이름 표시');
  await page.click('#fileDlg button[value=close]');

  // 2. 쓰는 대로 파일에 자동 저장
  await typeInEditor(page, ' 두 번째 문장이다.');
  await page.waitForTimeout(2500);
  saved = JSON.parse(await readFile(page, name));
  ok(saved.chapters[0].text.endsWith('두 번째 문장이다.'), '쓰는 대로 파일에 자동 저장');

  // 3. 새로고침해도 연결 유지
  await page.reload();
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.__bookEditor.fileOk), '새로고침 후에도 파일 연결 유지');
  await typeInEditor(page, ' 세 번째.');
  await page.waitForTimeout(2500);
  ok(JSON.parse(await readFile(page, name)).chapters[0].text.endsWith('세 번째.'), '새로고침 후에도 파일에 계속 저장');

  // 4. 다른 곳(다른 컴퓨터)에서 파일이 바뀌면 덮어쓰지 않음
  const external = JSON.parse(await readFile(page, name));
  external.chapters[0].text = '다른 컴퓨터에서 고친 원고.';
  external.savedAt = Date.now() + 60000;
  await page.waitForTimeout(1100); // 파일 수정 시각이 달라지도록
  await writeFile(page, name, JSON.stringify(external));
  await typeInEditor(page, ' 이 화면에서 더 씀.');
  await page.waitForTimeout(2500);
  ok(JSON.parse(await readFile(page, name)).chapters[0].text === '다른 컴퓨터에서 고친 원고.', '바깥에서 바뀐 파일은 덮어쓰지 않음');
  ok(await page.isVisible('#cfLoad'), '바뀌었다는 알림과 선택 버튼 표시');
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/10-file-conflict.png' });
  await page.click('#cfLoad');
  await page.waitForTimeout(500);
  ok((await page.inputValue('#editor')) === '다른 컴퓨터에서 고친 원고.', '‘파일 내용 불러오기’로 파일 쪽 원고를 가져옴');
  await typeInEditor(page, ' 이어 씀.');
  await page.waitForTimeout(2500);
  ok(JSON.parse(await readFile(page, name)).chapters[0].text === '다른 컴퓨터에서 고친 원고. 이어 씀.', '불러온 뒤에는 다시 자동 저장');

  // 5. 페이지를 닫아 둔 사이 파일이 더 최신이 되면, 열 때 물어봄
  const newer = JSON.parse(await readFile(page, name));
  newer.chapters[0].text = '밤사이 노트북에서 쓴 원고.';
  newer.savedAt = Date.now() + 120000;
  await writeFile(page, name, JSON.stringify(newer));
  dialogs.length = 0;
  await page.reload();
  await page.waitForTimeout(1000);
  ok(dialogs.some(m => m.includes('더 최신')), '열 때 파일이 더 최신이면 물어봄');
  ok((await page.inputValue('#editor')) === '밤사이 노트북에서 쓴 원고.', '‘확인’하면 최신 파일 내용으로 바뀜');

  // 6. 연결 끊기
  await page.click('#fileBtn');
  await page.click('#fsDisconnect');
  await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => window.__bookEditor.fileOk)) && (await page.isVisible('#fsCreate')), '연결 끊기');
  await page.click('#fileDlg button[value=close]');
  await typeInEditor(page, ' 끊은 뒤.');
  await page.waitForTimeout(2000);
  ok(!JSON.parse(await readFile(page, name)).chapters[0].text.includes('끊은 뒤'), '끊은 뒤에는 파일을 건드리지 않음');

  // 7. 이미 있는 원고 파일 열기 (전체 백업 파일도 열림)
  await writeFile(page, 'existing.json', JSON.stringify({ app: 'book-editor', title: '예전 책', chapters: [{ id: 'a', kind: 'chapter', title: '머리말', text: '예전에 쓴 머리말.' }], dictionary: [], savedAt: 1 }));
  await page.click('#fileBtn');
  await page.click('#fsOpen');
  await page.waitForTimeout(600);
  ok((await page.inputValue('#editor')) === '예전에 쓴 머리말.' && (await page.inputValue('#bookTitle')) === '예전 책', '이미 있는 원고 파일 열기');
  await page.click('#fileDlg button[value=close]');
  await typeInEditor(page, ' 덧붙임.');
  await page.waitForTimeout(2500);
  ok(JSON.parse(await readFile(page, 'existing.json')).chapters[0].text === '예전에 쓴 머리말. 덧붙임.', '연 파일에 이어서 자동 저장');

  // 안전장치: 다시 연결 도중 비정상 종료된 흔적이 있으면 건너뛰고 안내
  await page.evaluate(() => localStorage.setItem('book-editor:file-restoring', '1'));
  await page.reload();
  await page.waitForTimeout(800);
  ok((await page.textContent('#banner')).includes('건너뛰었어요') && !(await page.evaluate(() => window.__bookEditor.fileOk)), '다시 연결 중 문제가 생겼던 경우 건너뛰고 안내');
  ok((await page.inputValue('#editor')).includes('덧붙임'), '그래도 원고는 브라우저에 그대로 있음');

  ok(errors.length === 0, '자바스크립트 오류 없음' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // 8. 지원하지 않는 브라우저(사파리·파이어폭스·휴대폰)에서는 안내만
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript('delete window.showSaveFilePicker; delete window.showOpenFilePicker;');
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  await p2.click('#helpDlg button[value=close]');
  await p2.click('#fileBtn');
  ok((await p2.textContent('#fileBody')).includes('크롬·엣지'), '지원 안 하는 브라우저에서는 안내 문구 표시');

  await browser.close();
  console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
