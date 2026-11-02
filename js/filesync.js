/*
 * 원고 파일에 자동 저장 (컴퓨터용 크롬·엣지의 File System Access 기능)
 *
 * - 사용자가 고른 .json 파일 하나에 원고 전체(장·메모·표기 사전·설정)를 저장한다.
 * - 파일 '연결 정보'는 IndexedDB에 기억해 두고, 다음에 열 때 다시 연결한다.
 *   (브라우저 보안 때문에 다시 열면 한 번 '허용'을 눌러야 할 수 있다)
 * - 다른 곳(다른 컴퓨터 + 드라이브 동기화)에서 파일이 바뀌었으면 덮어쓰지 않고 멈춘다.
 */
(function (root) {
  'use strict';
  var KEY = 'fileHandle';
  var TYPES = [{ description: '책 원고 파일', accept: { 'application/json': ['.json'] } }];

  var FS = {
    supported: typeof root.showSaveFilePicker === 'function' && typeof root.showOpenFilePicker === 'function',
    handle: null,
    lastModified: null,   // 마지막으로 우리가 쓴 뒤 파일의 수정 시각
    get name() { return FS.handle ? FS.handle.name : ''; },

    // 저장해 둔 연결 정보 되살리기 → 'none' | 'granted' | 'prompt'
    // 지난번 다시 연결하다 페이지가 비정상 종료됐으면 'crashed' (같은 문제가 반복되지 않게 건너뜀)
    restore: async function () {
      if (!FS.supported) return 'none';
      var GUARD = 'book-editor:file-restoring';
      try {
        if (localStorage.getItem(GUARD)) {
          localStorage.removeItem(GUARD);
          await BookStorage.del(KEY);
          return 'crashed';
        }
        localStorage.setItem(GUARD, '1');
      } catch (e) { /* localStorage를 못 쓰면 안전장치 없이 진행 */ }
      try {
        var h = await BookStorage.get(KEY);
        if (!h || typeof h.queryPermission !== 'function') return 'none';
        FS.handle = h;
        return await h.queryPermission({ mode: 'readwrite' });
      } finally {
        try { localStorage.removeItem(GUARD); } catch (e) { /* 무시 */ }
      }
    },
    // 다시 허용 받기 (버튼 클릭 안에서 불러야 함)
    reconnect: async function () {
      return (await FS.handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    },
    create: async function (suggestedName, data) {
      var h = await root.showSaveFilePicker({ suggestedName: suggestedName, types: TYPES });
      FS.handle = h;
      await FS.write(data, true);
      await BookStorage.set(KEY, h);
    },
    open: async function () {
      var picked = await root.showOpenFilePicker({ types: TYPES, multiple: false });
      var h = picked[0];
      if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('파일에 저장할 권한을 받지 못했어요.');
      var r = await readHandle(h);
      FS.handle = h;
      FS.lastModified = r.lastModified;
      await BookStorage.set(KEY, h);
      return r.data;
    },
    read: async function () {
      var r = await readHandle(FS.handle);
      return r;
    },
    // force가 아니면, 마지막으로 쓴 뒤 다른 곳에서 파일이 바뀌었는지 먼저 확인
    write: async function (data, force) {
      var h = FS.handle;
      if (!h) return;
      if (!force && FS.lastModified !== null) {
        var f = await h.getFile();
        if (f.lastModified !== FS.lastModified) {
          var e = new Error('changed'); e.code = 'CHANGED'; throw e;
        }
      }
      var w = await h.createWritable();
      await w.write(JSON.stringify(Object.assign({ app: 'book-editor', format: 1 }, data), null, 1));
      await w.close();
      FS.lastModified = (await h.getFile()).lastModified;
    },
    disconnect: async function () {
      FS.handle = null; FS.lastModified = null;
      await BookStorage.del(KEY);
    }
  };

  async function readHandle(h) {
    var f = await h.getFile();
    var text = await f.text();
    var data = null;
    if (text.trim()) {
      data = JSON.parse(text);
      if (!data || !Array.isArray(data.chapters)) throw new Error('이 도구의 원고 파일이 아니에요.');
    }
    return { data: data, lastModified: f.lastModified };
  }

  root.FileSync = FS;
})(this);
