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
  function markDirty() {
    dirty = true;
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
      var t = new Date();
      $('#saveState').textContent = '자동 저장됨 · ' + t.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    }).catch(function (e) {
      dirty = true;
      $('#saveState').textContent = '저장 실패!';
      $('#saveState').classList.add('err');
      showBanner('브라우저에 저장하지 못했어요(' + (e && e.message || e) + '). 원고를 잃지 않도록 지금 <b>내보내기</b>로 파일을 받아 두세요.', true);
    });
  }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
  window.addEventListener('beforeunload', function (e) { if (dirty) { saveNow(); e.preventDefault(); e.returnValue = ''; } });

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
    markDirty();
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
    if (n && !confirm("'" + (c.title || '제목 없음') + "' " + label + '을(를) 지울까요? (' + n.toLocaleString() + '자)\n지우면 되살릴 수 없어요. 필요하면 먼저 내보내기를 해 두세요.')) return;
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
      delete data.app; delete data.exported;
      state = normalize(data);
      dirty = true; saveNow();
      $('#importDlg').close();
      boot();
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

  // ── 시작 ──
  function boot() {
    $('#bookTitle').value = state.title || '';
    document.title = (state.title ? state.title + ' — ' : '') + '책 원고 교정기';
    openDoc(state.currentId);
    dirty = false;
    $('#saveState').textContent = BookStorage.mode === 'indexeddb' ? '이 브라우저에 자동 저장 중' : '이 브라우저에 자동 저장 중(간이 저장소)';
    // 내보내기를 오래 안 했으면 알림
    var hasText = chapters().some(function (c) { return c.text.trim().length > 200; });
    var days = state.lastExport ? (Date.now() - state.lastExport) / 864e5 : Infinity;
    if (hasText && days > 7) {
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
  });

  // 시험용 (자동 테스트에서 사용)
  window.__bookEditor = { get state() { return state; }, get issues() { return issues; }, runCheck: runCheck, saveNow: saveNow };
})();
