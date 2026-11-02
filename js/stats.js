/* 분량 통계 (브라우저와 Node 양쪽에서 동작) */
(function (root) {
  'use strict';

  function count(text) {
    text = text || '';
    var withSpace = text.replace(/\n/g, '').length;
    var noSpace = text.replace(/\s/g, '').length;
    var paras = text.split('\n').filter(function (l) { return l.trim(); });
    var sentences = (text.match(/[^.!?…\n]+[.!?…]+/g) || []).length;
    return {
      withSpace: withSpace,
      noSpace: noSpace,
      paragraphs: paras.length,
      sentences: sentences,
      manuscript: manuscriptPages(paras)
    };
  }

  /*
   * 200자 원고지 매수 (근사값)
   * 원고지 한 장 = 20칸 × 10줄. 문단 첫머리는 한 칸 들여 쓰고, 문단이 끝나면 다음 줄로 넘어간다.
   * 글자·빈칸·문장부호 모두 한 칸으로 센다. (말줄임표 등 세세한 원고지 규칙은 반영하지 않음)
   */
  function manuscriptPages(paras) {
    var lines = 0;
    paras.forEach(function (p) {
      var cells = 1 + p.trim().length; // 들여쓰기 1칸
      lines += Math.ceil(cells / 20);
    });
    return lines ? Math.round((lines / 10) * 10) / 10 : 0;
  }

  var api = { count: count };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BookStats = api;
})(this);
