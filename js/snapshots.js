/*
 * 버전 기록(스냅샷)
 *  - 원고 전체(책 제목 + 모든 장·메모)를 통째로 찍어 브라우저(IndexedDB)에 보관한다.
 *  - 목록(가벼운 정보)은 'snapIndex' 하나에, 내용은 'snap:<id>'에 따로 둔다.
 *  - 바로 앞 기록과 내용이 같으면 새로 만들지 않는다.
 *  - 자동 기록은 최근 MAX_AUTO개, 직접 저장한 것은 MAX_MANUAL개까지 보관한다.
 * diff()는 브라우저와 Node 양쪽에서 쓸 수 있다.
 */
(function (root) {
  'use strict';
  var MAX_AUTO = 60, MAX_MANUAL = 100;

  var REASONS = {
    manual: '직접 저장',
    auto: '자동 (30분마다)',
    open: '사이트를 열 때',
    before: '바뀌기 직전'
  };

  // ── 문자열 지문 (같은 내용인지 빠르게 비교) ──
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  function content(state) {
    return {
      title: state.title || '',
      chapters: state.chapters.map(function (c) { return { id: c.id, kind: c.kind, title: c.title, text: c.text }; })
    };
  }

  // ── 문단 단위 비교, 바뀐 문단 안에서는 어절 단위 비교 ──
  // 결과: [{type:'same'|'del'|'add'|'mod', text?, parts?:[{type:'same'|'del'|'add', text}]}]
  function lcsOps(a, b, eq) {
    var n = a.length, m = b.length, ops = [];
    var p = 0;
    while (p < n && p < m && eq(a[p], b[p])) p++;
    var s = 0;
    while (s < n - p && s < m - p && eq(a[n - 1 - s], b[m - 1 - s])) s++;
    for (var i = 0; i < p; i++) ops.push({ type: 'same', a: a[i], b: b[i] });
    var A = a.slice(p, n - s), B = b.slice(p, m - s), mid = [];
    if (A.length * B.length > 4e6) {
      // 너무 크면 가운데를 통째로 '지움/더함'으로 처리
      A.forEach(function (x) { mid.push({ type: 'del', a: x }); });
      B.forEach(function (x) { mid.push({ type: 'add', b: x }); });
    } else {
      var N = A.length, M = B.length, W = M + 1;
      var L = new Uint32Array((N + 1) * W);
      for (var x = N - 1; x >= 0; x--) for (var y = M - 1; y >= 0; y--) {
        L[x * W + y] = eq(A[x], B[y]) ? L[(x + 1) * W + y + 1] + 1 : Math.max(L[(x + 1) * W + y], L[x * W + y + 1]);
      }
      var i2 = 0, j2 = 0;
      while (i2 < N && j2 < M) {
        if (eq(A[i2], B[j2])) { mid.push({ type: 'same', a: A[i2], b: B[j2] }); i2++; j2++; }
        else if (L[(i2 + 1) * W + j2] >= L[i2 * W + j2 + 1]) mid.push({ type: 'del', a: A[i2++] });
        else mid.push({ type: 'add', b: B[j2++] });
      }
      while (i2 < N) mid.push({ type: 'del', a: A[i2++] });
      while (j2 < M) mid.push({ type: 'add', b: B[j2++] });
    }
    ops = ops.concat(mid);
    for (var k = n - s; k < n; k++) ops.push({ type: 'same', a: a[k], b: b[k - n + m] });
    return ops;
  }
  function same(x, y) { return x === y; }

  function wordDiff(a, b) {
    var ta = a.match(/\s+|[^\s]+/g) || [], tb = b.match(/\s+|[^\s]+/g) || [];
    var parts = [];
    lcsOps(ta, tb, same).forEach(function (o) {
      var type = o.type, text = type === 'add' ? o.b : o.a;
      var last = parts[parts.length - 1];
      if (last && last.type === type) last.text += text; else parts.push({ type: type, text: text });
    });
    return parts;
  }

  function diff(oldText, newText) {
    var a = (oldText || '').split('\n'), b = (newText || '').split('\n');
    var ops = lcsOps(a, b, same), out = [];
    // 붙어 있는 '지움'과 '더함'은 짝지어 '고침'으로 보여 준다
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].type === 'same') { out.push({ type: 'same', text: ops[i].a }); continue; }
      var dels = [], adds = [];
      while (i < ops.length && ops[i].type !== 'same') {
        if (ops[i].type === 'del') dels.push(ops[i].a); else adds.push(ops[i].b);
        i++;
      }
      i--;
      var pairs = Math.min(dels.length, adds.length);
      for (var k = 0; k < pairs; k++) out.push({ type: 'mod', parts: wordDiff(dels[k], adds[k]) });
      for (k = pairs; k < dels.length; k++) out.push({ type: 'del', text: dels[k] });
      for (k = pairs; k < adds.length; k++) out.push({ type: 'add', text: adds[k] });
    }
    var added = 0, removed = 0;
    out.forEach(function (o) {
      if (o.type === 'add') added += o.text.length;
      if (o.type === 'del') removed += o.text.length;
      if (o.type === 'mod') o.parts.forEach(function (p) {
        if (p.type === 'add') added += p.text.replace(/\s/g, '').length;
        if (p.type === 'del') removed += p.text.replace(/\s/g, '').length;
      });
    });
    return { ops: out, added: added, removed: removed, changed: out.some(function (o) { return o.type !== 'same'; }) };
  }

  // ── 보관 (브라우저 전용) ──
  var Snap = {
    REASONS: REASONS,
    diff: diff,
    index: [],      // [{id, time, reason, label, chars, chapters, sig}] 최신이 앞
    ready: false,

    load: function () {
      return root.BookStorage.get('snapIndex').then(function (ix) {
        Snap.index = Array.isArray(ix) ? ix : [];
        Snap.ready = true;
      }).catch(function () { Snap.ready = false; });
    },
    lastTime: function () { return Snap.index.length ? Snap.index[0].time : 0; },

    // 바로 앞 기록과 같으면 null
    take: function (state, reason, label) {
      if (!Snap.ready) return Promise.resolve(null);
      var c = content(state);
      var sig = hash(JSON.stringify(c));
      if (Snap.index.length && Snap.index[0].sig === sig && reason !== 'manual') return Promise.resolve(null);
      var meta = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        time: Date.now(), reason: reason, label: label || '', sig: sig,
        chars: c.chapters.filter(function (x) { return x.kind === 'chapter'; }).reduce(function (n, x) { return n + x.text.replace(/\n/g, '').length; }, 0),
        chapters: c.chapters.filter(function (x) { return x.kind === 'chapter'; }).length
      };
      return root.BookStorage.set('snap:' + meta.id, c).then(function () {
        Snap.index.unshift(meta);
        return Snap.prune();
      }).then(function () { return meta; });
    },
    get: function (id) { return root.BookStorage.get('snap:' + id); },
    rename: function (id, label) {
      Snap.index.forEach(function (m) { if (m.id === id) { m.label = label; m.reason = 'manual'; } });
      return Snap.saveIndex();
    },
    remove: function (id) {
      Snap.index = Snap.index.filter(function (m) { return m.id !== id; });
      return Snap.saveIndex().then(function () { return root.BookStorage.del('snap:' + id); });
    },
    prune: function () {
      var auto = 0, manual = 0, drop = [];
      Snap.index = Snap.index.filter(function (m) {
        var keep = m.reason === 'manual' ? ++manual <= MAX_MANUAL : ++auto <= MAX_AUTO;
        if (!keep) drop.push(m.id);
        return keep;
      });
      return Snap.saveIndex().then(function () {
        return Promise.all(drop.map(function (id) { return root.BookStorage.del('snap:' + id); }));
      });
    },
    saveIndex: function () { return root.BookStorage.set('snapIndex', Snap.index); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { diff: diff };
  else root.Snapshots = Snap;
})(this);
