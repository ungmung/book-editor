/* 책 원고 교정기 — 화면 동작 */
(function () {
  'use strict';

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var DEFAULT_SETTINGS = {
    longSentence: 80, repeatMin: 3, endingRepeat: 3, ellipsis: 'auto', quote: 'auto',
    useLoanwords: true, categories: { spell: true, space: true, punct: true, style: true, term: true },
    disabledRules: {}
  };

  var state = null;          // 저장되는 전체 자료
  var issues = [];           // 지금 보고 있는 장의 지적 목록
  var activeKey = null;      // 선택된 지적
  var lastText = '';         // 직전 원고 (지적 위치 옮기기용)
  var saveTimer = null, checkTimer = null, dirty = false;

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function newDoc(kind, title, text) { return { id: uid(), kind: kind, title: title, text: text || '', updated: Date.now() }; }

  function emptyState() {
    var first = newDoc('chapter', '1장');
    return { v: 1, title: '', chapters: [first], currentId: first.id, dictionary: [], settings: clone(DEFAULT_SETTINGS), ignored: {}, lastExport: null, created: Date.now() };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function normalize(s) {
    if (!s || !Array.isArray(s.chapters)) return emptyState();
    s.settings = Object.assign(clone(DEFAULT_SETTINGS), s.settings || {});
    s.settings.categories = Object.assign(clone(DEFAULT_SETTINGS.categories), s.settings.categories || {});
    s.settings.disabledRules = s.settings.disabledRules || {};
    s.dictionary = s.dictionary || [];
    s.ignored = s.ignored || {};
    if (!s.chapters.length) s.chapters.push(newDoc('chapter', '1장'));
    s.chapters.forEach(function (c) { c.kind = c.kind === 'memo' ? 'memo' : 'chapter'; c.text = c.text || ''; c.title = c.title || ''; });
    if (!s.chapters.some(function (c) { return c.id === s.currentId; })) s.currentId = s.chapters[0].id;
    return s;
  }

  function current() { return state.chapters.filter(function (c) { return c.id === state.currentId; })[0]; }
  function chapters() { return state.chapters.filter(function (c) { return c.kind === 'chapter'; }); }
  function memos() { return state.chapters.filter(function (c) { return c.kind === 'memo'; }); }

  // ── 저장 ──
  // onlyNav: 장을 옮겨 다니기만 한 경우(내용은 그대로) — '마지막 수정 시각'은 바꾸지 않음
  function markDirty(onlyNav) {
    dirty = true;
    if (onlyNav !== true) state.savedAt = Date.now();
    $('#saveState').textContent = '저장 중…';
    $('#saveState').classList.remove('err');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return Promise.resolve();
    dirty = false;
    return BookStorage.save(state).then(function () {
      if (Snapshots.ready && Date.now() - Snapshots.lastTime() > AUTO_SNAP_MS) takeSnap('auto');
      if (FileSync.handle && fileOk) scheduleFileWrite();
      else setSaveState('자동 저장됨(브라우저) · ' + hhmm());
    }).catch(function (e) {
      dirty = true;
      $('#saveState').textContent = '저장 실패!';
      $('#saveState').classList.add('err');
      showBanner('브라우저에 저장하지 못했어요(' + (e && e.message || e) + '). 원고를 잃지 않도록 지금 <b>내보내기</b>로 파일을 받아 두세요.', true);
    });
  }
  function flushAll() { saveNow(); if (fileTimer) writeFileNow(); }
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });
  window.addEventListener('beforeunload', function (e) {
    if (dirty || fileTimer || fileWriting) { flushAll(); e.preventDefault(); e.returnValue = ''; }
  });

  function hhmm() { return new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }); }
  function setSaveState(text, kind) {
    var el = $('#saveState');
    el.textContent = text;
    el.classList.toggle('err', kind === 'err');
    el.classList.toggle('file', kind === 'file');
  }

  // ── 원고 파일에 저장 ──
  var fileOk = false, fileTimer = null, fileWriting = null;
  function scheduleFileWrite() {
    clearTimeout(fileTimer);
    setSaveState('📄 ' + FileSync.name + '에 저장 중…', 'file');
    fileTimer = setTimeout(writeFileNow, 1200);
  }
  function writeFileNow(force) {
    clearTimeout(fileTimer); fileTimer = null;
    if (!FileSync.handle || (!fileOk && !force)) return Promise.resolve();
    var snapshot = state;
    fileWriting = (fileWriting || Promise.resolve()).then(function () {
      return FileSync.write(snapshot, force);
    }).then(function () {
      fileOk = true;
      setSaveState('📄 ' + FileSync.name + '에 저장됨 · ' + hhmm(), 'file');
      $('#banner').hidden = true; // 내보내기 알림·오류 알림은 이제 필요 없음
      renderFileDlg();
    }).catch(function (e) {
      fileOk = false;
      if (e && e.code === 'CHANGED') {
        setSaveState('📄 파일 저장 멈춤', 'err');
        showBanner('원고 파일 <b>' + esc(FileSync.name) + '</b>이(가) 다른 곳(다른 컴퓨터나 프로그램)에서 바뀌었어요. 덮어쓰지 않고 저장을 멈췄어요. 원고는 이 브라우저에는 계속 저장돼요. ' +
          '<button type="button" class="small" id="cfLoad">파일 내용 불러오기</button> <button type="button" class="small" id="cfWrite">이 화면 내용으로 덮어쓰기</button>', true);
        $('#cfLoad').onclick = function () { loadFromFile(true); };
        $('#cfWrite').onclick = function () {
          if (!confirm('파일에 있는 내용을 지금 이 화면의 원고로 덮어쓸까요?\n파일 쪽에서 고친 내용은 사라져요.')) return;
          $('#banner').hidden = true; writeFileNow(true);
        };
      } else {
        setSaveState('📄 파일 저장 실패', 'err');
        showBanner('원고 파일에 저장하지 못했어요(' + esc(e && (e.name === 'NotFoundError' ? '파일을 찾을 수 없음 — 옮기거나 지웠나요?' : e.message) || e) + '). 원고는 이 브라우저에는 저장돼 있어요. <b>원고 파일</b> 버튼에서 다시 연결해 주세요.', true);
      }
      renderFileDlg();
    }).finally(function () { fileWriting = null; });
    return fileWriting;
  }
  // 파일 내용을 읽어 화면에 넣기 (ask=true면 먼저 물어봄)
  function loadFromFile(ask) {
    return FileSync.read().then(function (r) {
      if (!r.data) return writeFileNow(true);
      if (ask && !confirm('원고 파일 내용으로 바꿀까요?\n지금 이 화면(브라우저)에 있는 원고는 파일 내용으로 대체돼요.')) return;
      FileSync.lastModified = r.lastModified;
      replaceState(r.data);
      fileOk = true;
      $('#banner').hidden = true;
      setSaveState('📄 ' + FileSync.name + '에서 불러옴 · ' + hhmm(), 'file');
      toast('원고 파일 내용을 불러왔어요.');
    });
  }
  function replaceState(data) {
    takeSnap('before', '다른 원고(파일·백업)로 바꾸기 전');
    data = JSON.parse(JSON.stringify(data));
    delete data.app; delete data.exported; delete data.format;
    state = normalize(data);
    dirty = true; saveNow();
    boot();
  }
  // 연결된 파일과 브라우저 중 어느 쪽이 최신인지 확인
  function syncWithFile() {
    return FileSync.read().then(function (r) {
      FileSync.lastModified = r.lastModified;
      var fileTime = r.data && r.data.savedAt || 0, mine = state.savedAt || 0;
      if (r.data && fileTime > mine + 2000) {
        var when = new Date(fileTime).toLocaleString('ko-KR');
        if (confirm('원고 파일 「' + FileSync.name + '」이(가) 이 브라우저보다 더 최신이에요(' + when + ' 저장).\n다른 컴퓨터에서 고친 것 같아요. 파일 내용으로 바꿀까요?\n\n[취소]를 누르면 파일 연결을 끊고 파일은 그대로 둬요.')) {
          replaceState(r.data);
          fileOk = true;
          setSaveState('📄 ' + FileSync.name + '에서 불러옴 · ' + hhmm(), 'file');
        } else {
          return FileSync.disconnect().then(function () {
            fileOk = false; setSaveState('이 브라우저에 자동 저장 중'); renderFileDlg();
            toast('파일 연결을 끊었어요. 파일은 바뀌지 않았어요.', 5000);
          });
        }
      } else {
        fileOk = true;
        return writeFileNow(true);
      }
      renderFileDlg();
    }).catch(function (e) {
      fileOk = false;
      setSaveState('📄 파일 연결 안 됨', 'err');
      showBanner('연결해 둔 원고 파일을 열지 못했어요(' + esc(e && (e.name === 'NotFoundError' ? '파일을 찾을 수 없음 — 옮기거나 지웠나요?' : e.message) || e) + '). <b>원고 파일</b> 버튼에서 다시 연결해 주세요.', true);
      renderFileDlg();
    });
  }

  function renderFileDlg() {
    var box = $('#fileBody');
    if (!box) return;
    var btn = $('#fileBtn');
    btn.classList.toggle('primary', !!(FileSync.handle && fileOk));
    btn.textContent = FileSync.handle && fileOk ? '📄 ' + FileSync.name : '원고 파일';
    if (!FileSync.supported) {
      box.innerHTML = '<p>이 브라우저는 파일에 바로 저장하는 기능이 없어요. 이 기능은 <b>컴퓨터의 크롬·엣지</b>에서만 돼요(사파리·파이어폭스·휴대폰은 안 돼요).</p>' +
        '<p>대신 <b>내보내기 → 전체 백업(.json)</b>으로 자주 파일을 받아 두세요. 그 파일을 나중에 크롬·엣지에서 ‘이미 있는 원고 파일 열기’로 열면 자동 저장을 이어 갈 수 있어요.</p>';
      return;
    }
    if (FileSync.handle) {
      box.innerHTML = '<div class="file-box">' + (fileOk ? '✅ ' : '⚠️ ') + '연결된 파일: <b>' + esc(FileSync.name) + '</b><br>' +
        (fileOk ? '<span class="hint">쓰는 대로 이 파일에 자동 저장돼요. 브라우저에도 함께 저장돼요.</span>' : '<span class="hint">지금은 파일에 저장하지 않고 있어요. 다시 연결을 눌러 주세요.</span>') + '</div>' +
        '<div class="file-actions">' + (fileOk ? '' : '<button type="button" class="primary" id="fsReconnect">다시 연결</button>') +
        '<button type="button" id="fsDisconnect">연결 끊기</button></div>' +
        '<p class="hint">브라우저 보안 때문에 사이트를 다시 열면 ‘파일 편집 허용’을 한 번 더 물어볼 수 있어요. 그때 허용을 누르면 돼요.</p>' +
        '<p class="hint">파일이 어느 폴더에 있는지는 브라우저가 알려 주지 않아요. 만들 때 고른 폴더를 기억해 두세요.</p>';
      if ($('#fsReconnect')) $('#fsReconnect').onclick = function () {
        FileSync.reconnect().then(function (ok) {
          if (!ok) { toast('허용하지 않아서 연결하지 못했어요.'); return; }
          $('#banner').hidden = true;
          return syncWithFile();
        }).catch(fileError);
      };
      $('#fsDisconnect').onclick = function () {
        if (!confirm('파일 연결을 끊을까요?\n파일은 지워지지 않고 그대로 남아요. 원고는 이 브라우저에 계속 저장돼요.')) return;
        FileSync.disconnect().then(function () { fileOk = false; setSaveState('이 브라우저에 자동 저장 중'); renderFileDlg(); toast('연결을 끊었어요.'); });
      };
      return;
    }
    box.innerHTML = '<p>원고를 <b>내 컴퓨터의 파일 하나</b>에 쓰는 대로 자동 저장해요. 브라우저 기록을 지워도 원고가 파일로 남아요.</p>' +
      '<p class="hint">💡 <b>구글 드라이브·원드라이브·드롭박스 폴더</b>에 만들면 그 프로그램이 무료로 백업하고 다른 컴퓨터와도 맞춰 줘요. 이 파일 하나에 모든 장·메모·표기 사전·설정이 들어 있어요.</p>' +
      '<div class="file-actions"><button type="button" class="primary" id="fsCreate">새 원고 파일 만들기</button>' +
      '<button type="button" id="fsOpen">이미 있는 원고 파일 열기</button></div>' +
      '<p class="hint">‘새 원고 파일 만들기’는 지금 쓰고 있는 원고를 그대로 파일에 담아요. ‘열기’는 전에 만든 원고 파일(또는 전체 백업 파일)을 열어 이어서 써요.</p>';
    $('#fsCreate').onclick = function () {
      var name = (state.title || '내 원고').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '-원고.json';
      FileSync.create(name, state).then(function () {
        fileOk = true; $('#banner').hidden = true;
        setSaveState('📄 ' + FileSync.name + '에 저장됨 · ' + hhmm(), 'file');
        renderFileDlg(); toast('원고 파일을 만들었어요. 이제 쓰는 대로 이 파일에 저장돼요.', 5000);
      }).catch(fileError);
    };
    $('#fsOpen').onclick = function () {
      FileSync.open().then(function (data) {
        var hasText = state.chapters.some(function (c) { return c.text.trim(); });
        if (!data) { fileOk = true; return writeFileNow(true); }
        if (hasText && !confirm('「' + FileSync.name + '」의 원고로 바꿀까요?\n지금 이 화면(브라우저)에 있는 원고는 파일 내용으로 대체돼요.\n(필요하면 [취소] 후 먼저 내보내기를 해 두세요)')) {
          return FileSync.disconnect().then(renderFileDlg);
        }
        replaceState(data);
        fileOk = true; $('#banner').hidden = true;
        setSaveState('📄 ' + FileSync.name + '에서 불러옴 · ' + hhmm(), 'file');
        renderFileDlg(); toast('원고 파일을 열었어요. 이제 쓰는 대로 이 파일에 저장돼요.', 5000);
      }).catch(fileError);
    };
  }
  function fileError(e) {
    if (e && e.name === 'AbortError') return; // 고르기 창을 닫음
    alert('원고 파일을 다루지 못했어요.\n' + (e && e.message || e));
    renderFileDlg();
  }

  function showBanner(html, isErr) {
    var b = $('#banner');
    b.innerHTML = html + ' <button type="button" class="small" id="bannerClose">닫기</button>';
    b.classList.toggle('err', !!isErr);
    b.hidden = false;
    $('#bannerClose').onclick = function () { b.hidden = true; };
  }
  var toastTimer;
  function toast(html, ms) {
    var t = $('#toast');
    t.innerHTML = html; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3000);
  }

  // ── 목록 ──
  function renderLists() {
    function item(c) {
      var n = BookStats.count(c.text).withSpace;
      return '<li><button type="button" data-id="' + c.id + '" aria-current="' + (c.id === state.currentId) + '">' +
        '<span>' + esc(c.title || '(제목 없음)') + '</span><span class="n">' + n.toLocaleString() + '자</span></button></li>';
    }
    $('#chapterList').innerHTML = chapters().map(item).join('') || '<li class="hint">장이 없어요.</li>';
    $('#memoList').innerHTML = memos().map(item).join('') || '<li class="hint">메모가 없어요.</li>';
    var tot = chapters().reduce(function (a, c) { var s = BookStats.count(c.text); a.w += s.withSpace; a.p += s.manuscript; return a; }, { w: 0, p: 0 });
    $('#bookTotal').innerHTML = '원고 전체 <b>' + tot.w.toLocaleString() + '자</b> · 원고지 약 <b>' + Math.ceil(tot.p).toLocaleString() + '매</b>';
  }
  function onListClick(e) {
    var b = e.target.closest('button[data-id]');
    if (!b) return;
    openDoc(b.getAttribute('data-id'));
    if (isNarrow()) setView('editor');
  }
  $('#chapterList').addEventListener('click', onListClick);
  $('#memoList').addEventListener('click', onListClick);

  function openDoc(id) {
    state.currentId = id;
    var c = current();
    var ed = $('#editor');
    ed.value = c.text;
    lastText = c.text;
    $('#docTitle').value = c.title;
    $('#docTitle').placeholder = c.kind === 'memo' ? '메모 제목' : '장 제목';
    $('#memoToChapter').hidden = c.kind !== 'memo';
    ed.placeholder = c.kind === 'memo' ? '떠오른 생각을 자유롭게 적어 두세요.' : '여기에 원고를 쓰세요. 쓰는 대로 자동 저장돼요.';
    activeKey = null;
    autosize();
    renderLists();
    runCheck();
    $('#editorScroll').scrollTop = 0;
    markDirty(true);
  }

  $('#addChapter').onclick = function () {
    var n = chapters().length + 1;
    var d = newDoc('chapter', n + '장');
    // 마지막 장 바로 뒤(메모보다 앞)에 넣기
    var lastIdx = -1;
    state.chapters.forEach(function (c, i) { if (c.kind === 'chapter') lastIdx = i; });
    state.chapters.splice(lastIdx + 1, 0, d);
    openDoc(d.id);
    $('#docTitle').select();
    if (isNarrow()) setView('editor');
  };
  $('#addMemo').onclick = function () {
    var t = new Date();
    var d = newDoc('memo', '메모 ' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + t.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }));
    state.chapters.push(d);
    openDoc(d.id);
    if (isNarrow()) setView('editor');
    $('#editor').focus();
  };
  $('#docTitle').addEventListener('input', function () {
    current().title = this.value; current().updated = Date.now();
    renderLists(); markDirty();
  });
  $('#bookTitle').addEventListener('input', function () { state.title = this.value; markDirty(); document.title = (this.value ? this.value + ' — ' : '') + '책 원고 교정기'; });

  function move(dir) {
    var c = current(), same = state.chapters.filter(function (x) { return x.kind === c.kind; });
    var i = same.indexOf(c), j = i + dir;
    if (j < 0 || j >= same.length) return;
    var a = state.chapters.indexOf(c), b = state.chapters.indexOf(same[j]);
    state.chapters[a] = same[j]; state.chapters[b] = c;
    renderLists(); markDirty();
  }
  $('#moveUp').onclick = function () { move(-1); };
  $('#moveDown').onclick = function () { move(1); };
  $('#deleteDoc').onclick = function () {
    var c = current();
    var label = c.kind === 'memo' ? '메모' : '장';
    var n = c.text.length;
    if (n && !confirm("'" + (c.title || '제목 없음') + "' " + label + '을(를) 지울까요? (' + n.toLocaleString() + '자)\n지운 뒤에도 \'버전 기록\'에서 되살릴 수 있어요.')) return;
    if (n) takeSnap('before', "'" + (c.title || '제목 없음') + "' " + label + ' 지우기 전');
    var idx = state.chapters.indexOf(c);
    state.chapters.splice(idx, 1);
    if (!state.chapters.length) state.chapters.push(newDoc('chapter', '1장'));
    var next = state.chapters[Math.max(0, idx - 1)];
    openDoc(next.id);
    toast(label + '을(를) 지웠어요.');
  };
  $('#memoToChapter').onclick = function () {
    var c = current();
    c.kind = 'chapter';
    var idx = state.chapters.indexOf(c);
    state.chapters.splice(idx, 1);
    var lastIdx = -1;
    state.chapters.forEach(function (x, i) { if (x.kind === 'chapter') lastIdx = i; });
    state.chapters.splice(lastIdx + 1, 0, c);
    openDoc(c.id);
    toast('원고의 마지막 장으로 옮겼어요. ▲▼로 순서를 바꿀 수 있어요.');
  };

  // ── 편집기 ──
  var ed = $('#editor');
  function autosize() {
    var sc = $('#editorScroll'), top = sc.scrollTop;
    ed.style.height = 'auto';
    ed.style.height = ed.scrollHeight + 'px';
    sc.scrollTop = top;
  }
  ed.addEventListener('input', function () {
    var c = current();
    var text = ed.value;
    shiftIssues(lastText, text);
    lastText = text;
    c.text = text; c.updated = Date.now();
    autosize();
    renderBackdrop();
    updateMeta();
    markDirty();
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runCheck, 800);
  });
  // 글을 고치면, 고친 곳보다 뒤에 있는 지적의 위치를 그만큼 옮긴다 (다시 점검할 때까지 색칠이 어긋나지 않게)
  function shiftIssues(oldT, newT) {
    if (!issues.length) return;
    var p = 0, max = Math.min(oldT.length, newT.length);
    while (p < max && oldT[p] === newT[p]) p++;
    var s = 0;
    while (s < max - p && oldT[oldT.length - 1 - s] === newT[newT.length - 1 - s]) s++;
    var oldEnd = oldT.length - s, delta = newT.length - oldT.length;
    issues = issues.filter(function (x) {
      if (x.end < p || (x.end === p && x.start < p)) return true;
      if (x.start >= oldEnd && x.start > p) { x.start += delta; x.end += delta; return true; }
      return false;
    });
  }

  function renderBackdrop() {
    var text = ed.value, html = '', pos = 0;
    var shown = issues.filter(visibleIssue).slice().sort(function (a, b) { return a.start - b.start; });
    shown.forEach(function (x) {
      if (x.start < pos) return; // 겹치면 앞의 것만 색칠
      html += esc(text.slice(pos, x.start));
      var cls = 'lv-' + x.level + (x.key === activeKey ? ' active' : '');
      if (x.start === x.end) html += '<mark class="ins ' + cls + '" data-k="' + esc(x.key) + '"></mark>';
      else html += '<mark class="' + cls + '" data-k="' + esc(x.key) + '">' + esc(text.slice(x.start, x.end)) + '</mark>';
      pos = x.end;
    });
    html += esc(text.slice(pos)) + '\n ';
    $('#backdrop').innerHTML = html;
  }

  function updateMeta() {
    var s = BookStats.count(ed.value);
    $('#docMeta').textContent = '공백 포함 ' + s.withSpace.toLocaleString() + '자 · 공백 제외 ' + s.noSpace.toLocaleString() + '자 · 원고지 약 ' + s.manuscript + '매 · 문단 ' + s.paragraphs;
  }

  // 커서가 놓인 곳의 지적을 오른쪽 목록에서 찾아 보여 주기
  function caretToIssue() {
    var pos = ed.selectionStart;
    var hit = issues.filter(visibleIssue).filter(function (x) { return x.start <= pos && pos <= Math.max(x.end, x.start + 1); })[0];
    if (hit && hit.key !== activeKey) {
      activeKey = hit.key;
      renderBackdrop(); renderIssues();
      var card = $('.issue[data-k="' + cssEsc(hit.key) + '"]');
      if (card && !isNarrow()) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  ed.addEventListener('click', caretToIssue);
  ed.addEventListener('keyup', function (e) { if (/Arrow|Home|End|Page/.test(e.key)) caretToIssue(); });
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

  // ── 점검 ──
  function checkOptions() {
    var st = state.settings;
    var dom = Rules.dominantStyles(state.chapters.map(function (c) { return c.text; }));
    var ell = st.ellipsis === 'auto' ? dom.ellipsis : (st.ellipsis === 'off' ? null : st.ellipsis);
    var q = st.quote === 'auto' ? dom.quote : (st.quote === 'off' ? null : st.quote);
    return {
      longSentence: st.longSentence, repeatMin: st.repeatMin, endingRepeat: st.endingRepeat,
      useLoanwords: st.useLoanwords, dictionary: state.dictionary, disabledRules: st.disabledRules,
      categories: st.categories, ellipsis: ell, quoteStyle: q
    };
  }
  function runCheck() {
    clearTimeout(checkTimer);
    var text = ed.value;
    issues = Rules.check(text, checkOptions()).filter(function (x) { return !state.ignored[x.key]; });
    lastText = text;
    if (activeKey && !issues.some(function (x) { return x.key === activeKey; })) activeKey = null;
    renderBackdrop(); renderIssues(); updateMeta(); renderStats(); renderLists();
  }
  $('#runCheck').onclick = function () {
    runCheck();
    var n = issues.filter(visibleIssue).length;
    toast(n ? '지적 ' + n + '개를 찾았어요.' : '찾은 지적이 없어요. 👍');
    if (isNarrow()) setView('side');
  };

  function levelOn(l) { var cb = $('#levelFilters input[value="' + l + '"]'); return !cb || cb.checked; }
  function visibleIssue(x) {
    var cat = $('#catFilter').value;
    return levelOn(x.level) && (!cat || x.cat === cat);
  }
  $$('#levelFilters input').forEach(function (cb) { cb.addEventListener('change', function () { renderBackdrop(); renderIssues(); }); });
  $('#catFilter').addEventListener('change', function () { renderBackdrop(); renderIssues(); });

  function renderIssues() {
    var counts = { error: 0, check: 0, style: 0 };
    var cat = $('#catFilter').value;
    issues.forEach(function (x) { if (!cat || x.cat === cat) counts[x.level]++; });
    Object.keys(counts).forEach(function (k) { $('#levelFilters [data-n="' + k + '"]').textContent = counts[k]; });
    var shown = issues.filter(visibleIssue);
    var total = issues.length;
    $('#issueCount').textContent = total || '';
    $('#issueCountMobile').textContent = total || '';
    var text = ed.value;
    if (!shown.length) {
      $('#issueList').innerHTML = '<div class="empty">' + (text.trim() ? (total ? '고른 조건에 맞는 지적이 없어요.' : '찾은 지적이 없어요.<br>규칙으로 찾을 수 있는 흔한 실수는 없다는 뜻이에요.') : '원고를 쓰면 여기에 점검 결과가 나와요.') + '</div>';
    } else {
      $('#issueList').innerHTML = shown.map(function (x) {
        var before = text.slice(Math.max(0, x.start - 12), x.start).replace(/\n/g, ' ');
        var after = text.slice(x.end, x.end + 12).replace(/\n/g, ' ');
        var diff;
        var orig = x.original;
        if (x.level === 'style' && orig.length > 40) orig = orig.slice(0, 40) + '…';
        if (x.suggestion !== null && x.suggestion !== undefined) {
          diff = '<span class="ctx">…' + esc(before) + '</span>' + (orig ? '<del>' + esc(visibleSpaces(orig)) + '</del>' : '') +
            '<ins>' + esc(visibleSpaces(x.suggestion) || '(지우기)') + '</ins><span class="ctx">' + esc(after) + '…</span>';
        } else {
          diff = '<span class="ctx">…' + esc(before) + '</span><del style="text-decoration:none">' + esc(orig) + '</del><span class="ctx">' + esc(after) + '…</span>';
        }
        var canApply = x.suggestion !== null && x.suggestion !== undefined;
        return '<div class="issue lv-' + x.level + (x.key === activeKey ? ' active' : '') + '" data-k="' + esc(x.key) + '">' +
          '<div class="issue-top"><span class="badge lv-' + x.level + '">' + Rules.LEVELS[x.level] + '</span>' +
          '<span class="issue-title">' + esc(x.title) + '</span><span class="issue-cat">' + Rules.CATS[x.cat] + '</span></div>' +
          '<div class="issue-diff">' + diff + '</div>' +
          '<div class="issue-explain">' + esc(x.explain) + '</div>' +
          '<div class="issue-actions">' +
          (canApply ? '<button type="button" class="primary" data-act="apply">적용</button>' : '') +
          '<button type="button" data-act="ignore">무시</button>' +
          '<button type="button" data-act="ask" title="이 문장을 claude.ai에 물어볼 수 있게 복사">Claude에 물어보기</button>' +
          '<button type="button" data-act="off" class="ghost" title="이 종류의 지적을 더는 하지 않음">이 규칙 끄기</button>' +
          '</div></div>';
      }).join('');
    }
    var nIgn = Object.keys(state.ignored).length;
    $('#ignoredNote').innerHTML = nIgn ? '무시한 지적 ' + nIgn + '개는 숨겨져 있어요. <button type="button" id="unignore">모두 다시 보기</button>' : '';
    if (nIgn) $('#unignore').onclick = function () {
      if (!confirm('무시한 지적 ' + nIgn + '개를 모두 다시 보이게 할까요?')) return;
      state.ignored = {}; markDirty(); runCheck();
    };
  }
  function visibleSpaces(s) { return s.replace(/ /g, '␣'); }

  $('#issueList').addEventListener('click', function (e) {
    var card = e.target.closest('.issue');
    if (!card) return;
    var key = card.getAttribute('data-k');
    var x = issues.filter(function (i) { return i.key === key; })[0];
    if (!x) return;
    var act = e.target.closest('button') && e.target.closest('button').getAttribute('data-act');
    if (act === 'apply') return applyIssue(x);
    if (act === 'ignore') {
      state.ignored[x.key] = true; markDirty();
      issues = issues.filter(function (i) { return i !== x; });
      renderBackdrop(); renderIssues();
      return;
    }
    if (act === 'ask') return askClaude(x);
    if (act === 'off') {
      if (!confirm("'" + x.title + "' 지적을 앞으로 하지 않을까요?\n(설정 → 꺼 둔 규칙에서 다시 켤 수 있어요)")) return;
      state.settings.disabledRules[x.ruleId] = x.title; markDirty(); runCheck();
      return;
    }
    // 카드를 누르면 원고의 그 자리로 이동
    activeKey = key;
    renderBackdrop(); renderIssues();
    if (isNarrow()) setView('editor');
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(x.start, x.end);
    var m = $('#backdrop mark[data-k="' + cssEsc(key) + '"]');
    if (m) {
      var sc = $('#editorScroll');
      var top = m.offsetTop + $('.editor-wrap').offsetTop - sc.clientHeight / 3;
      sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  });

  function applyIssue(x) {
    var text = ed.value;
    if (text.slice(x.start, x.end) !== x.original) { runCheck(); toast('원고가 바뀌어서 다시 점검했어요. 한 번 더 눌러 주세요.'); return; }
    var editorVisible = ed.offsetParent !== null;
    var ok = false;
    if (editorVisible) {
      // execCommand를 쓰면 Ctrl+Z(되돌리기)가 돼요
      ed.focus({ preventScroll: true });
      ed.setSelectionRange(x.start, x.end);
      try {
        ok = x.suggestion === '' ? document.execCommand('delete') : document.execCommand('insertText', false, x.suggestion);
      } catch (e) { ok = false; }
      if (ok && ed.value.slice(x.start, x.start + x.suggestion.length) !== x.suggestion) ok = false;
    }
    if (!ok) {
      ed.setRangeText(x.suggestion, x.start, x.end, 'end');
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    runCheck();
    renderLists();
    toast('고쳤어요.' + (editorVisible ? ' 되돌리려면 Ctrl+Z (맥은 ⌘+Z)' : ''));
  }

  function sentenceAround(text, s, e) {
    var a = s, b = e;
    while (a > 0 && !/[.!?…\n]/.test(text[a - 1])) a--;
    while (b < text.length && !/[.!?…\n]/.test(text[b])) b++;
    while (b < text.length && /[.!?…"”’']/.test(text[b])) b++;
    return text.slice(a, b).trim();
  }
  function copyText(s) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s);
    return new Promise(function (resolve, reject) {
      var t = document.createElement('textarea');
      t.value = s; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* 무시 */ }
      document.body.removeChild(t);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }
  function askClaude(x) {
    var text = ed.value;
    var sent = sentenceAround(text, x.start, x.end);
    var q = '제가 쓰고 있는 에세이의 한 문장이에요. 맞춤법·띄어쓰기·문장의 자연스러움을 검토해 주세요. 고칠 곳이 있으면 고친 문장과 이유를 쉽게 알려 주시고, 문제가 없으면 없다고 말해 주세요.\n\n' +
      '교정 도구가 지적한 점: ' + x.title + ' (' + Rules.LEVELS[x.level] + ')' +
      (x.suggestion !== null ? " — '" + x.original + "' → '" + x.suggestion + "'" : " — '" + (x.original.length > 30 ? x.original.slice(0, 30) + '…' : x.original) + "'") +
      '\n\n문장: ' + sent;
    copyText(q).then(function () {
      toast('질문을 복사했어요. <a href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai 열기</a>에서 붙여 넣으세요(Ctrl+V).', 6000);
    }, function () { prompt('아래 내용을 복사해서 claude.ai에 붙여 넣으세요.', q); });
  }
  $('#copySelection').onclick = function () {
    var s = ed.value.slice(ed.selectionStart, ed.selectionEnd).trim();
    if (!s) { toast('먼저 원고에서 물어보고 싶은 부분을 마우스로 끌어서 선택하세요.'); return; }
    var q = '제가 쓰고 있는 에세이의 일부예요. 맞춤법·띄어쓰기·문장의 자연스러움을 검토해 주세요. 고칠 곳은 고친 문장과 이유를 쉽게 알려 주세요. 제 문체와 말투는 되도록 살려 주세요.\n\n' + s;
    copyText(q).then(function () {
      toast('선택한 부분(' + s.length + '자)을 질문과 함께 복사했어요. <a href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai 열기</a>', 6000);
    }, function () { prompt('아래 내용을 복사해서 claude.ai에 붙여 넣으세요.', q); });
  };

  // ── 통계 ──
  function renderStats() {
    var c = current(), s = BookStats.count(c.text);
    var rows = chapters().map(function (ch) { return { ch: ch, s: BookStats.count(ch.text) }; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.s.withSpace; }).concat([1]));
    var tot = rows.reduce(function (a, r) { a.w += r.s.withSpace; a.n += r.s.noSpace; a.p += r.s.manuscript; return a; }, { w: 0, n: 0, p: 0 });
    var memoTot = memos().reduce(function (a, m) { return a + BookStats.count(m.text).withSpace; }, 0);
    var avg = s.sentences ? Math.round(s.noSpace / s.sentences) : 0;
    $('#statsPanel').innerHTML =
      '<h3>지금 보는 ' + (c.kind === 'memo' ? '메모' : '장') + ' — ' + esc(c.title || '(제목 없음)') + '</h3>' +
      '<div class="stat-cards">' +
      card(s.withSpace, '글자 수 (공백 포함)') + card(s.noSpace, '글자 수 (공백 제외)') +
      card(s.manuscript, '200자 원고지 (매, 근사값)') + card(s.paragraphs, '문단') +
      card(s.sentences, '문장') + card(avg, '문장 평균 길이 (공백 제외 자)') +
      '</div>' +
      '<h3>장별 분량</h3>' +
      '<table class="stat-table"><thead><tr><th>장</th><th>공백 포함</th><th>공백 제외</th><th>원고지</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.ch.title || '(제목 없음)') + '<div class="bar" style="width:' + Math.round(r.s.withSpace / max * 100) + '%"></div></td><td>' +
          r.s.withSpace.toLocaleString() + '</td><td>' + r.s.noSpace.toLocaleString() + '</td><td>' + r.s.manuscript + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td>합계</td><td>' + tot.w.toLocaleString() + '</td><td>' + tot.n.toLocaleString() + '</td><td>' + (Math.round(tot.p * 10) / 10) + '</td></tr></tfoot></table>' +
      '<p class="hint">원고지 매수는 200자 원고지(20칸×10줄)에 문단마다 한 칸 들여 쓰고, 문단이 끝나면 다음 줄로 넘어간다고 셈한 근사값이에요. 단행본은 대개 원고지 600~1,000매(공백 포함 약 10~17만 자) 안팎이에요.</p>' +
      (memoTot ? '<p class="hint">메모 ' + memos().length + '개, ' + memoTot.toLocaleString() + '자는 원고 분량에 넣지 않았어요.</p>' : '');
    function card(v, k) { return '<div class="stat-card"><div class="v">' + (typeof v === 'number' ? v.toLocaleString() : v) + '</div><div class="k">' + k + '</div></div>'; }
  }

  $$('.tabs button').forEach(function (b) {
    b.onclick = function () {
      $$('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      $$('.tab-panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== b.getAttribute('data-tab'); });
      if (b.getAttribute('data-tab') === 'stats') renderStats();
    };
  });

  // ── 휴대폰 화면 전환 ──
  function isNarrow() { return window.matchMedia('(max-width: 900px)').matches; }
  function setView(v) {
    document.body.setAttribute('data-view', v);
    if (v === 'editor') requestAnimationFrame(autosize);
  }
  $$('.bottom-nav button').forEach(function (b) { b.onclick = function () { setView(b.getAttribute('data-view')); }; });
  window.addEventListener('resize', function () { autosize(); });

  // ── 대화 상자 ──
  $$('[data-open]').forEach(function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-open');
      if (id === 'dictDlg') renderDict();
      if (id === 'settingsDlg') renderSettings();
      $('#' + id).showModal();
    };
  });

  // 내보내기
  function dateStamp() { var d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  function safeName(s) { return (s || '원고').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || '원고'; }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  $('#exportForm').addEventListener('change', function () {
    var fmt = $('#exportForm').fmt.value;
    $('#rangeSet').disabled = fmt === 'json';
  });
  $('#doExport').onclick = function (e) {
    e.preventDefault();
    saveNow();
    var f = $('#exportForm'), fmt = f.fmt.value, range = f.range.value, withMemos = f.memos.checked;
    var base = safeName(state.title) + '-' + dateStamp();
    if (fmt === 'json') {
      download(new Blob([JSON.stringify(Object.assign({ app: 'book-editor', exported: new Date().toISOString() }, state), null, 1)], { type: 'application/json' }), base + '-백업.json');
    } else {
      var list = range === 'current' ? [current()] : chapters().concat(withMemos ? memos() : []);
      var book = { title: state.title, chapters: list.map(function (c) { return { title: c.title, text: c.text }; }) };
      if (range === 'current') base = safeName(state.title) + '-' + safeName(current().title) + '-' + dateStamp();
      download(fmt === 'docx' ? BookFiles.buildDocx(book) : BookFiles.buildTxt(book), base + '.' + fmt);
    }
    state.lastExport = Date.now(); markDirty();
    $('#banner').hidden = true;
    $('#exportDlg').close();
    toast('파일을 내려받았어요. 다운로드 폴더를 확인하세요.');
  };

  // 불러오기
  $('#importFile').addEventListener('change', function () {
    var file = this.files[0];
    var asMemo = $('#importAsMemo').checked;
    this.value = '';
    if (!file) return;
    var name = file.name.replace(/\.[^.]+$/, '');
    file.arrayBuffer().then(function (buf) {
      if (/\.docx$/i.test(file.name)) return BookFiles.parseDocx(buf, name);
      if (/\.hwpx?$/i.test(file.name)) throw new Error('한글(hwp) 파일은 바로 읽을 수 없어요. 한글 프로그램에서 "다른 이름으로 저장 → 워드 문서(*.docx)"로 바꾼 뒤 불러오세요.');
      if (/\.doc$/i.test(file.name)) throw new Error('옛 워드 형식(.doc)은 읽을 수 없어요. 워드에서 .docx로 다시 저장해 주세요.');
      return BookFiles.parseTxt(buf, name);
    }).then(function (list) {
      if (!list.length) throw new Error('파일에 글이 없어요.');
      var added = list.map(function (c) { return newDoc(asMemo ? 'memo' : 'chapter', c.title, c.text); });
      if (asMemo) state.chapters = state.chapters.concat(added);
      else {
        var lastIdx = -1;
        state.chapters.forEach(function (x, i) { if (x.kind === 'chapter') lastIdx = i; });
        // 처음 상태(빈 1장 하나)라면 그 빈 장은 정리
        var only = chapters();
        if (only.length === 1 && !only[0].text.trim() && only[0].title === '1장') {
          state.chapters.splice(state.chapters.indexOf(only[0]), 1); lastIdx--;
        }
        Array.prototype.splice.apply(state.chapters, [lastIdx + 1, 0].concat(added));
      }
      $('#importDlg').close();
      openDoc(added[0].id);
      toast(added.length + '개의 ' + (asMemo ? '메모' : '장') + '을(를) 불러왔어요.');
    }).catch(function (err) { alert('불러오지 못했어요.\n' + (err && err.message || err)); });
  });
  $('#restoreFile').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) return;
    file.text().then(function (t) {
      var data = JSON.parse(t);
      if (!data || !Array.isArray(data.chapters)) throw new Error('이 도구의 백업 파일이 아니에요.');
      var n = data.chapters.length;
      if (!confirm('백업(' + (data.exported ? new Date(data.exported).toLocaleString('ko-KR') : '날짜 모름') + ', 장·메모 ' + n + '개)으로 바꿀까요?\n지금 이 브라우저에 있는 원고는 백업 내용으로 대체돼요.')) return;
      $('#importDlg').close();
      replaceState(data);
      toast('백업으로 되살렸어요.');
    }).catch(function (err) { alert('백업 파일을 읽지 못했어요.\n' + (err && err.message || err)); });
  });

  // 표기 사전
  function renderDict() {
    var rows = state.dictionary;
    $('#dictRows').innerHTML = rows.map(function (r, i) {
      return '<div class="dict-row" data-i="' + i + '">' +
        '<input type="text" data-f="right" value="' + esc(r.right || '') + '" placeholder="예: 도스토옙스키" aria-label="바른 표기">' +
        '<input type="text" data-f="wrongs" value="' + esc(r.wrongs || '') + '" placeholder="예: 도스토예프스키, 도스또옙스키" aria-label="틀린 표기">' +
        '<input type="text" data-f="note" value="' + esc(r.note || '') + '" placeholder="예: 인물 이름" aria-label="메모">' +
        '<button type="button" class="small danger" data-del="' + i + '">삭제</button></div>';
    }).join('') || '<p class="hint">아직 비어 있어요. ‘+ 한 줄 추가’를 눌러 시작하세요.</p>';
    $('#useLoanwords').checked = state.settings.useLoanwords;
    $('#loanList').textContent = Rules.LOANWORDS.map(function (p) { return p[1].split(',').join('/') + ' → ' + p[0]; }).join(' · ');
  }
  $('#dictRows').addEventListener('input', function (e) {
    var row = e.target.closest('.dict-row'); if (!row) return;
    state.dictionary[+row.getAttribute('data-i')][e.target.getAttribute('data-f')] = e.target.value;
    markDirty();
  });
  $('#dictRows').addEventListener('click', function (e) {
    var d = e.target.getAttribute('data-del'); if (d === null) return;
    state.dictionary.splice(+d, 1); markDirty(); renderDict();
  });
  $('#addDict').onclick = function () {
    state.dictionary.push({ right: '', wrongs: '', note: '' }); markDirty(); renderDict();
    var inputs = $$('#dictRows input[data-f=right]'); inputs[inputs.length - 1].focus();
  };
  $('#useLoanwords').onchange = function () { state.settings.useLoanwords = this.checked; markDirty(); };
  $('#dictDlg').addEventListener('close', runCheck);

  // 설정
  function renderSettings() {
    var st = state.settings;
    $('#setLong').value = st.longSentence; $('#setRepeat').value = st.repeatMin; $('#setEnding').value = st.endingRepeat;
    $('#setEllipsis').value = st.ellipsis; $('#setQuote').value = st.quote;
    $('#catToggles').innerHTML = Object.keys(Rules.CATS).map(function (k) {
      return '<label class="check-row"><input type="checkbox" data-cat="' + k + '"' + (st.categories[k] !== false ? ' checked' : '') + '> ' + Rules.CATS[k] + '</label>';
    }).join('');
    var off = Object.keys(st.disabledRules);
    $('#disabledRules').innerHTML = off.length ? off.map(function (id) {
      return '<div class="check-row">' + esc(typeof st.disabledRules[id] === 'string' ? st.disabledRules[id] : id) + ' <button type="button" class="small" data-on="' + esc(id) + '">다시 켜기</button></div>';
    }).join('') : '없음';
  }
  $('#settingsDlg').addEventListener('change', function (e) {
    var st = state.settings, t = e.target;
    if (t.id === 'setLong') st.longSentence = Math.max(30, +t.value || 80);
    if (t.id === 'setRepeat') st.repeatMin = Math.max(2, +t.value || 3);
    if (t.id === 'setEnding') st.endingRepeat = Math.max(2, +t.value || 3);
    if (t.id === 'setEllipsis') st.ellipsis = t.value;
    if (t.id === 'setQuote') st.quote = t.value;
    if (t.getAttribute('data-cat')) st.categories[t.getAttribute('data-cat')] = t.checked;
    markDirty(); runCheck();
  });
  $('#disabledRules').addEventListener('click', function (e) {
    var id = e.target.getAttribute('data-on'); if (!id) return;
    delete state.settings.disabledRules[id]; markDirty(); renderSettings(); runCheck();
  });

  // 예문 체험
  var DEMO = '오랫만에 바다에 갔다. 몇일 동안 비가 와서 걱정했는데 날이 맑았다 .그는 나에게 "이제 어떻해?" 하고 물었다.\n' +
    '나는 할수 있다고 대답했지만 사실 자신이 없었다. 인생에 있어서 중요한 것은 포기하지 않는 것이다.\n' +
    '그때 들었던 노래는 지금도 잊혀지지 않는다…… 그날의 바다는 정말 아름다웠고 바다 냄새가 좋았고 바다 소리가 마음을 편안하게 해 주었기 때문에 나는 오래도록 그 자리에 앉아서 바다를 바라보며 아무 생각도 하지 않으려고 애썼다...\n' +
    '내일 다시 갈꺼야. 그때는 꼭 메세지를 남길께.';
  $('#tryDemo').onclick = function () {
    var d = newDoc('memo', '점검 체험용 예문', DEMO);
    state.chapters.push(d);
    $('#helpDlg').close();
    openDoc(d.id);
    if (isNarrow()) setView('side');
    toast('예문을 메모로 넣었어요. 오른쪽 지적을 눌러 보세요. 다 보면 ‘삭제’로 지우세요.', 5000);
  };

  // ── 버전 기록 ──
  var AUTO_SNAP_MS = 30 * 60 * 1000;
  function takeSnap(reason, label) {
    if (!Snapshots.ready) return Promise.resolve(null);
    return Snapshots.take(state, reason, label).catch(function (e) {
      console.warn('버전 기록 실패', e);
      return null;
    });
  }
  var hist = { id: null, snap: null, chId: null };
  function fmtTime(t) { return new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(t) {
    var d = new Date(t), now = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(now) - day(d)) / 864e5);
    if (diff === 0) return '오늘';
    if (diff === 1) return '어제';
    return d.toLocaleDateString('ko-KR', { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  }
  function bookChars() { return chapters().reduce(function (n, c) { return n + c.text.replace(/\n/g, '').length; }, 0); }

  function openHistory() {
    if (!Snapshots.ready) { alert('이 브라우저에서는 버전 기록을 쓸 수 없어요(브라우저 저장소를 쓸 수 없음).'); return; }
    saveNow();
    hist.id = null;
    $('#snapName').value = '';
    renderSnapList();
    if (Snapshots.index.length) selectSnap(Snapshots.index[0].id);
    else $('#snapDetail').innerHTML = '<div class="empty">아직 기록이 없어요. ‘지금 버전 저장’을 눌러 첫 기록을 남겨 보세요.</div>';
    if (!$('#historyDlg').open) $('#historyDlg').showModal();
  }
  $('#openHistory').onclick = openHistory;

  function renderSnapList() {
    var html = '', lastDay = null, ix = Snapshots.index;
    ix.forEach(function (m, i) {
      var day = fmtDay(m.time);
      if (day !== lastDay) { html += '<div class="snap-day">' + esc(day) + '</div>'; lastDay = day; }
      var older = ix[i + 1], delta = older ? m.chars - older.chars : null;
      html += '<button type="button" class="snap-item" data-id="' + m.id + '" aria-current="' + (m.id === hist.id) + '">' +
        '<span class="c">' + m.chars.toLocaleString() + '자' + (delta ? ' (' + (delta > 0 ? '+' : '') + delta.toLocaleString() + ')' : '') + '</span>' +
        '<span class="t">' + fmtTime(m.time) + '</span> <span class="r">' + (m.reason === 'manual' ? '★ ' : '') + Snapshots.REASONS[m.reason] + '</span>' +
        (m.label ? '<span class="l">' + esc(m.label) + '</span>' : '') + '</button>';
    });
    $('#snapList').innerHTML = html || '<div class="empty">기록 없음</div>';
  }
  $('#snapList').addEventListener('click', function (e) {
    var b = e.target.closest('.snap-item');
    if (b) selectSnap(b.getAttribute('data-id'));
  });

  function selectSnap(id) {
    hist.id = id;
    $$('#snapList .snap-item').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-id') === id); });
    $('#snapDetail').innerHTML = '<div class="empty">불러오는 중…</div>';
    Snapshots.get(id).then(function (snap) {
      if (hist.id !== id) return;
      if (!snap) { $('#snapDetail').innerHTML = '<div class="empty">이 기록을 읽지 못했어요.</div>'; return; }
      hist.snap = snap;
      // 보여 줄 장: 지금 보던 장이 바뀌었으면 그 장 → 아니면 바뀐(지운) 장 → 지금 보던 장 → 첫 장
      var ids = snap.chapters.map(function (c) { return c.id; });
      var curIn = ids.indexOf(state.currentId) >= 0;
      var curChanged = curIn && isChanged(snap.chapters[ids.indexOf(state.currentId)]);
      hist.chId = curChanged ? state.currentId : (firstChanged(snap) || (curIn ? state.currentId : ids[0]));
      renderSnapDetail();
    });
  }
  function nowDoc(id) { return state.chapters.filter(function (c) { return c.id === id; })[0]; }
  function isChanged(x) { var n = nowDoc(x.id); return !n || n.text !== x.text || n.title !== x.title; }
  function firstChanged(snap) {
    var c = snap.chapters.filter(isChanged)[0];
    return c && c.id;
  }

  function renderSnapDetail() {
    var snap = hist.snap, meta = Snapshots.index.filter(function (m) { return m.id === hist.id; })[0];
    if (!snap || !meta) return;
    var ch = snap.chapters.filter(function (c) { return c.id === hist.chId; })[0];
    var cur = ch && nowDoc(ch.id);
    var opts = snap.chapters.map(function (c) {
      var n = nowDoc(c.id);
      var mark = !n ? ' — 지금은 없음' : (n.text !== c.text || n.title !== c.title ? ' — 바뀜' : '');
      return '<option value="' + c.id + '"' + (c.id === hist.chId ? ' selected' : '') + '>' + (c.kind === 'memo' ? '[메모] ' : '') + esc(c.title || '(제목 없음)') + mark + '</option>';
    }).join('');
    var newer = chapters().concat(memos()).filter(function (c) { return snap.chapters.every(function (x) { return x.id !== c.id; }); });
    var html = '<div><b>' + new Date(meta.time).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '</b> · ' +
      Snapshots.REASONS[meta.reason] + (meta.label ? ' · ' + esc(meta.label) : '') +
      '<div class="hint">그때 원고 ' + meta.chars.toLocaleString() + '자, 장 ' + meta.chapters + '개 (지금 ' + bookChars().toLocaleString() + '자, 장 ' + chapters().length + '개)</div></div>';
    html += '<label>비교할 장 <select id="snapCh">' + opts + '</select></label>';
    if (newer.length) html += '<div class="hint">이 기록 뒤에 새로 만든 장·메모: ' + newer.map(function (c) { return esc(c.title || '(제목 없음)'); }).join(', ') + '</div>';

    var d = ch ? Snapshots.diff(ch.text, cur ? cur.text : '') : null;
    html += '<div class="snap-actions">' +
      (ch ? '<button type="button" class="primary" data-sa="restoreCh"' + (cur && !d.changed && cur.title === ch.title ? ' disabled' : '') + '>' + (cur ? '이 장을 이 버전으로 되돌리기' : '이 장 되살리기') + '</button>' : '') +
      '<button type="button" data-sa="restoreAll">원고 전체를 이 버전으로</button>' +
      (ch ? '<button type="button" data-sa="copy">이 장 글 복사</button>' : '') +
      '<button type="button" data-sa="rename">' + (meta.reason === 'manual' ? '이름 바꾸기' : '이름 붙여 보관') + '</button>' +
      '<button type="button" class="danger" data-sa="delete">이 기록 지우기</button></div>';

    if (ch) {
      if (!cur) {
        html += '<p class="hint">이 장(메모)은 지금 원고에 없어요(지웠거나 다른 원고로 바꿨어요). ‘이 장 되살리기’를 누르면 다시 넣어요.</p>' +
          '<div class="diff">' + ch.text.split('\n').map(function (p) { return '<p>' + (esc(p) || '&nbsp;') + '</p>'; }).join('') + '</div>';
      } else if (!d.changed) {
        html += '<p class="hint">이 장의 글은 지금과 똑같아요.' + (cur.title !== ch.title ? " (제목만 달라요: 그때 '" + esc(ch.title) + "')" : '') + '</p>';
      } else {
        html += '<div class="diff-legend">그때 → 지금: <span class="d-del">지운 글</span> <span class="d-add">새로 쓴 글</span> · 더한 글 ' + d.added.toLocaleString() + '자, 지운 글 ' + d.removed.toLocaleString() + '자 (공백 제외)</div>' +
          '<div class="diff">' + renderDiff(d.ops) + '</div>';
      }
    }
    $('#snapDetail').innerHTML = html;
    $('#snapCh').onchange = function () { hist.chId = this.value; renderSnapDetail(); };
  }
  // 바뀐 문단과 그 앞뒤 한 문단만 보여 주고, 나머지 같은 문단은 '⋯ 같은 문단 N개 ⋯'로 접는다
  function renderDiff(ops) {
    var CTX = 1, show = ops.map(function () { return false; });
    ops.forEach(function (o, i) {
      if (o.type === 'same') return;
      for (var k = Math.max(0, i - CTX); k <= Math.min(ops.length - 1, i + CTX); k++) show[k] = true;
    });
    var out = [], hidden = 0;
    function flush() { if (hidden) out.push('<p class="d-skip">⋯ 같은 문단 ' + hidden + '개 ⋯</p>'); hidden = 0; }
    ops.forEach(function (o, i) {
      if (!show[i]) { hidden++; return; }
      flush();
      if (o.type === 'same') out.push('<p>' + (esc(o.text) || '&nbsp;') + '</p>');
      else if (o.type === 'del') out.push('<p class="d-del">' + (esc(o.text) || '(빈 줄)') + '</p>');
      else if (o.type === 'add') out.push('<p class="d-add">' + (esc(o.text) || '(빈 줄)') + '</p>');
      else out.push('<p>' + o.parts.map(function (p) {
        return p.type === 'same' ? esc(p.text) : '<span class="d-' + p.type + '">' + esc(p.text) + '</span>';
      }).join('') + '</p>');
    });
    flush();
    return out.join('');
  }

  $('#snapDetail').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sa]'); if (!b) return;
    var act = b.getAttribute('data-sa'), snap = hist.snap;
    var meta = Snapshots.index.filter(function (m) { return m.id === hist.id; })[0];
    var ch = snap && snap.chapters.filter(function (c) { return c.id === hist.chId; })[0];
    var when = meta ? fmtDay(meta.time) + ' ' + fmtTime(meta.time) : '';
    if (act === 'restoreCh' && ch) {
      var cur = nowDoc(ch.id);
      if (!confirm("'" + (ch.title || '제목 없음') + "'을(를) " + when + ' 버전으로 ' + (cur ? '되돌릴까요?' : '되살릴까요?') + '\n지금 글은 버전 기록에 먼저 남겨 둬서, 마음이 바뀌면 다시 돌아올 수 있어요.')) return;
      takeSnap('before', "'" + (ch.title || '제목 없음') + "' 되돌리기 전").then(function () {
        if (cur) { cur.text = ch.text; cur.title = ch.title; cur.updated = Date.now(); }
        else {
          var copy = newDoc(ch.kind, ch.title, ch.text); copy.id = ch.id;
          var lastIdx = -1;
          state.chapters.forEach(function (x, i) { if (x.kind === ch.kind) lastIdx = i; });
          state.chapters.splice(lastIdx + 1, 0, copy);
        }
        markDirty();
        openDoc(ch.id);
        saveNow();
        renderSnapList(); selectSnap(hist.id);
        toast("'" + (ch.title || '제목 없음') + "'을(를) " + when + ' 버전으로 ' + (cur ? '되돌렸어요.' : '되살렸어요.'));
      });
    }
    if (act === 'restoreAll') {
      var gone = chapters().concat(memos()).filter(function (c) { return snap.chapters.every(function (x) { return x.id !== c.id; }); });
      if (!confirm('원고 전체(모든 장·메모)를 ' + when + ' 버전으로 되돌릴까요?' +
        (gone.length ? '\n그 뒤에 새로 만든 ' + gone.length + '개(' + gone.map(function (c) { return c.title; }).slice(0, 3).join(', ') + (gone.length > 3 ? ' 등' : '') + ')는 빠져요.' : '') +
        '\n표기 사전과 설정은 그대로예요. 지금 원고는 버전 기록에 먼저 남겨 둬요.')) return;
      takeSnap('before', '원고 전체 되돌리기 전').then(function () {
        state.title = snap.title;
        state.chapters = snap.chapters.map(function (c) { var d = newDoc(c.kind, c.title, c.text); d.id = c.id; return d; });
        if (!state.chapters.length) state.chapters.push(newDoc('chapter', '1장'));
        if (!nowDoc(state.currentId)) state.currentId = state.chapters[0].id;
        $('#bookTitle').value = state.title || '';
        markDirty();
        openDoc(state.currentId);
        saveNow();
        renderSnapList(); selectSnap(hist.id);
        toast('원고 전체를 ' + when + ' 버전으로 되돌렸어요.');
      });
    }
    if (act === 'copy' && ch) {
      copyText(ch.text).then(function () { toast('이 버전의 글을 복사했어요. 원하는 곳에 붙여 넣으세요.'); }, function () { prompt('아래 글을 복사하세요.', ch.text); });
    }
    if (act === 'rename' && meta) {
      var name = prompt('이 기록의 이름 (이름을 붙인 기록은 자동 기록보다 오래 보관돼요)', meta.label || '');
      if (name === null) return;
      Snapshots.rename(meta.id, name.trim()).then(function () { renderSnapList(); renderSnapDetail(); });
    }
    if (act === 'delete' && meta) {
      if (!confirm(when + ' 기록을 지울까요? 원고에는 영향이 없어요.')) return;
      Snapshots.remove(meta.id).then(function () {
        hist.id = null; renderSnapList();
        if (Snapshots.index.length) selectSnap(Snapshots.index[0].id);
        else $('#snapDetail').innerHTML = '<div class="empty">기록이 없어요.</div>';
      });
    }
  });
  $('#snapNow').onclick = function () {
    saveNow();
    var label = $('#snapName').value.trim();
    Snapshots.take(state, 'manual', label || '').then(function (m) {
      $('#snapName').value = '';
      renderSnapList();
      if (m) selectSnap(m.id);
      toast('지금 버전을 저장했어요.');
    }).catch(function (e) { alert('저장하지 못했어요.\n' + (e && e.message || e)); });
  };
  $('#snapName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#snapNow').click(); } });

  // ── 시작 ──
  function boot() {
    $('#bookTitle').value = state.title || '';
    document.title = (state.title ? state.title + ' — ' : '') + '책 원고 교정기';
    openDoc(state.currentId);
    dirty = false;
    if (!(FileSync.handle && fileOk)) setSaveState(BookStorage.mode === 'indexeddb' ? '이 브라우저에 자동 저장 중' : '이 브라우저에 자동 저장 중(간이 저장소)');
    renderFileDlg();
    // 내보내기를 오래 안 했으면 알림
    var hasText = chapters().some(function (c) { return c.text.trim().length > 200; });
    var days = state.lastExport ? (Date.now() - state.lastExport) / 864e5 : Infinity;
    if (hasText && days > 7 && !(FileSync.handle && fileOk)) {
      showBanner('원고는 이 브라우저에만 저장돼 있어요. ' + (state.lastExport ? Math.floor(days) + '일 동안' : '아직 한 번도') + ' 파일로 내보내지 않았어요. <button type="button" class="small primary" id="bannerExport">지금 내보내기</button>');
      $('#bannerExport').onclick = function () { $('#exportDlg').showModal(); };
    }
  }

  BookStorage.load().then(function (data) {
    state = normalize(data);
    if (!data) dirty = true;
    boot();
    if (!data) { saveNow(); $('#helpDlg').showModal(); }
    BookStorage.persist();
    return Snapshots.load().then(function () {
      var hasText = state.chapters.some(function (c) { return c.text.trim(); });
      return hasText ? takeSnap('open', '') : null;
    }).then(function () {
      return FileSync.restore();
    }).then(function (perm) {
      if (perm === 'granted') return syncWithFile();
      if (perm === 'crashed') {
        showBanner('지난번에 원고 파일을 다시 연결하다가 문제가 생겨서 이번에는 건너뛰었어요. 원고는 브라우저에 그대로 있어요. <b>원고 파일 → 이미 있는 원고 파일 열기</b>로 다시 연결해 주세요.', true);
        renderFileDlg();
        return;
      }
      if (perm === 'prompt') {
        renderFileDlg();
        $('#banner').hidden = true;
        showBanner('원고 파일 <b>' + esc(FileSync.name) + '</b>에 계속 저장하려면 눌러 주세요. (브라우저 보안 때문에 다시 열 때마다 한 번 허용이 필요할 수 있어요) <button type="button" class="small primary" id="bannerReconnect">다시 연결</button>');
        $('#bannerReconnect').onclick = function () {
          FileSync.reconnect().then(function (ok) {
            if (!ok) { toast('허용하지 않아서 연결하지 못했어요. 원고는 브라우저에 계속 저장돼요.'); return; }
            $('#banner').hidden = true;
            return syncWithFile();
          }).catch(fileError);
        };
      }
    });
  });

  // 시험용 (자동 테스트에서 사용)
  window.__bookEditor = { get state() { return state; }, get issues() { return issues; }, runCheck: runCheck, saveNow: saveNow, takeSnap: takeSnap, writeFileNow: writeFileNow, get fileOk() { return fileOk; } };
})();
