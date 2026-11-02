/*
 * 외부 라이브러리 없이 docx(워드) 파일을 만들고 읽는다.
 * docx는 XML 파일 몇 개를 zip으로 묶은 것이다.
 *  - 쓰기: 압축 없이(stored) zip을 만든다. 워드·한글·구글 문서 모두 열 수 있다.
 *  - 읽기: 브라우저 내장 DecompressionStream('deflate-raw')로 압축을 푼다.
 */
(function (root) {
  'use strict';

  // ── CRC32 ──
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ── zip 쓰기 (stored) ──
  function makeZip(files) { // files: [{name, data: Uint8Array}]
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  // ── zip 읽기 ──
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 풀기를 지원하지 않아요. 최신 크롬·엣지·사파리·파이어폭스를 써 주세요.');
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function readZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('docx 파일이 아니거나 손상된 파일이에요.');
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder(), entries = {};
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method: method, csize: csize, local: local };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(entries),
      read: async function (name) {
        var e = entries[name];
        if (!e) return null;
        var l = e.local, start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
        var raw = u8.subarray(start, start + e.csize);
        if (e.method === 0) return raw;
        if (e.method === 8) return inflateRaw(raw);
        throw new Error('지원하지 않는 압축 방식이에요.');
      }
    };
  }

  // ── docx 만들기 ──
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // XML에 넣을 수 없는 제어 문자 제거
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function runXml(text) {
    // 탭은 w:tab으로
    return text.split('\t').map(function (t, i) {
      return (i ? '<w:r><w:tab/></w:r>' : '') + (t ? '<w:r><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>' : '');
    }).join('');
  }
  function buildDocx(book) { // book: {title, chapters:[{title, text}]}
    var body = [];
    book.chapters.forEach(function (ch, idx) {
      body.push('<w:p><w:pPr><w:pStyle w:val="Heading1"/>' + (idx ? '<w:pageBreakBefore/>' : '') + '</w:pPr>' + runXml(ch.title || '') + '</w:p>');
      (ch.text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
        body.push(line ? '<w:p>' + runXml(line) + '</w:p>' : '<w:p/>');
      });
    });
    var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' + W + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles ' + W + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Batang" w:eastAsia="바탕" w:hAnsi="Batang" w:cs="Batang"/><w:sz w:val="22"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
      '</w:styles>';
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(book.title || '') + '</dc:title>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
    var enc = new TextEncoder();
    return makeZip([
      { name: '[Content_Types].xml', data: enc.encode(ct) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: 'word/document.xml', data: enc.encode(doc) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
      { name: 'word/styles.xml', data: enc.encode(styles) },
      { name: 'docProps/core.xml', data: enc.encode(core) }
    ]);
  }

  // ── docx 읽기 → [{title, text}] ──
  var WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  async function parseDocx(buf, fallbackTitle) {
    var zip = await readZip(buf);
    var docBytes = await zip.read('word/document.xml');
    if (!docBytes) throw new Error('워드 문서(docx)가 아닌 것 같아요. 한글(hwp) 파일이라면 한글 프로그램에서 "다른 이름으로 저장 → docx"로 바꿔 주세요.');
    var stylesBytes = await zip.read('word/styles.xml');
    var dec = new TextDecoder();
    var parser = new DOMParser();
    var doc = parser.parseFromString(dec.decode(docBytes), 'application/xml');

    // 제목 1 스타일 찾기 (워드·한글·구글 문서마다 이름이 달라서 styles.xml에서 확인)
    var headingIds = {};
    if (stylesBytes) {
      var st = parser.parseFromString(dec.decode(stylesBytes), 'application/xml');
      Array.prototype.forEach.call(st.getElementsByTagNameNS(WNS, 'style'), function (s) {
        var id = s.getAttributeNS(WNS, 'styleId') || s.getAttribute('w:styleId');
        var nm = s.getElementsByTagNameNS(WNS, 'name')[0];
        var name = nm ? (nm.getAttributeNS(WNS, 'val') || nm.getAttribute('w:val') || '') : '';
        var ol = s.getElementsByTagNameNS(WNS, 'outlineLvl')[0];
        var olv = ol ? (ol.getAttributeNS(WNS, 'val') || ol.getAttribute('w:val')) : null;
        if (/^(heading 1|제목 1|title)$/i.test(name) || olv === '0') headingIds[id] = true;
      });
    }
    function attr(el, n) { return el.getAttributeNS(WNS, n) || el.getAttribute('w:' + n); }

    var paras = doc.getElementsByTagNameNS(WNS, 'p');
    var chapters = [], cur = null, intro = [];
    Array.prototype.forEach.call(paras, function (p) {
      var text = '';
      var walker = doc.createTreeWalker(p, 1 /* ELEMENT */);
      var node;
      while ((node = walker.nextNode())) {
        if (node.namespaceURI !== WNS) continue;
        if (node.localName === 't') text += node.textContent;
        else if (node.localName === 'tab') text += '\t';
        else if (node.localName === 'br' && attr(node, 'type') !== 'page') text += '\n';
      }
      var isHeading = false;
      var ps = p.getElementsByTagNameNS(WNS, 'pStyle')[0];
      if (ps) {
        var v = attr(ps, 'val') || '';
        if (headingIds[v] || /^(heading ?1|제목 ?1|title)$/i.test(v)) isHeading = true;
      }
      var ol = p.getElementsByTagNameNS(WNS, 'outlineLvl')[0];
      if (ol && attr(ol, 'val') === '0') isHeading = true;
      if (isHeading && text.trim()) {
        cur = { title: text.trim(), lines: [] };
        chapters.push(cur);
      } else {
        (cur ? cur.lines : intro).push(text);
      }
    });
    function clean(lines) {
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return lines.join('\n');
    }
    var out = chapters.map(function (c) { return { title: c.title, text: clean(c.lines) }; });
    var introText = clean(intro);
    if (introText) out.unshift({ title: chapters.length ? '앞부분' : (fallbackTitle || '불러온 원고'), text: introText });
    return out;
  }

  // ── txt ──
  function buildTxt(book) {
    var s = book.chapters.map(function (c) { return '# ' + (c.title || '') + '\n\n' + (c.text || ''); }).join('\n\n\n');
    return new Blob(['﻿' + s.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
  }
  function decodeText(buf) {
    var u8 = new Uint8Array(buf);
    var text = new TextDecoder('utf-8').decode(u8);
    // 깨진 글자가 많으면 윈도우 메모장의 옛 형식(EUC-KR)으로 다시 읽기
    var bad = (text.match(/�/g) || []).length;
    if (bad > 0) {
      try {
        var t2 = new TextDecoder('euc-kr').decode(u8);
        if ((t2.match(/�/g) || []).length < bad) text = t2;
      } catch (e) { /* 지원 안 하면 그대로 */ }
    }
    return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  }
  function parseTxt(buf, fallbackTitle) {
    var text = decodeText(buf);
    var lines = text.split('\n'), chapters = [], cur = null, intro = [];
    lines.forEach(function (l) {
      var m = l.match(/^#\s+(.+)$/);
      if (m) { cur = { title: m[1].trim(), lines: [] }; chapters.push(cur); }
      else (cur ? cur.lines : intro).push(l);
    });
    function clean(ls) {
      while (ls.length && !ls[0].trim()) ls.shift();
      while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
      return ls.join('\n');
    }
    var out = chapters.map(function (c) { return { title: c.title, text: clean(c.lines) }; });
    var it = clean(intro);
    if (it) out.unshift({ title: chapters.length ? '앞부분' : (fallbackTitle || '불러온 원고'), text: it });
    return out;
  }

  root.BookFiles = { buildDocx: buildDocx, parseDocx: parseDocx, buildTxt: buildTxt, parseTxt: parseTxt, _readZip: readZip };
})(this);
