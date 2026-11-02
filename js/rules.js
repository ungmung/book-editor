/*
 * 교정 규칙 엔진 (브라우저와 Node 양쪽에서 동작)
 *
 * 원칙: 잘못된 교정 제안을 하느니 놓치는 편이 낫다.
 *  - level 'error' : 거의 확실히 틀린 표기. 고칠 말을 제안한다.
 *  - level 'check' : 문맥에 따라 맞을 수도 있음. '확인 필요'로 표시한다.
 *  - level 'style' : 틀린 것은 아니지만 문장을 다듬을 때 참고할 점.
 *
 * check(text, options) → 지적 목록 [{ruleId, cat, level, title, explain, start, end, original, suggestion}]
 */
(function (root) {
  'use strict';

  var CATS = {
    spell: '맞춤법',
    space: '띄어쓰기',
    punct: '문장부호',
    style: '문장 다듬기',
    term: '표기 통일'
  };
  var LEVELS = {
    error: '고치기 권장',
    check: '확인 필요',
    style: '참고'
  };

  // ── 한글 음절 도우미 ─────────────────────────────
  function isHangul(ch) {
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }
  function jong(ch) { // 받침 번호 (0 = 받침 없음, 8 = ㄹ)
    if (!isHangul(ch)) return -1;
    return (ch.charCodeAt(0) - 0xac00) % 28;
  }
  function hasBatchim(ch) { return jong(ch) > 0; }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var RULES = [];

  /**
   * 정규식 규칙 등록
   * def.re      : g 플래그가 있는 정규식
   * def.pick(m, text) → null(무시) 또는 {start, end, suggestion}
   *   생략하면 매치 전체를 대상으로 하고 def.fix(m)로 고칠 말을 만든다.
   */
  function addRule(def) { RULES.push(def); }

  function simple(id, cat, level, title, explain, re, fix) {
    addRule({ id: id, cat: cat, level: level, title: title, explain: explain, re: re, fix: fix });
  }

  // ════════════════════════════════════════════
  // 1. 맞춤법 — 거의 확실한 것들
  // ════════════════════════════════════════════

  // 단순 낱말 교체 목록: [아이디, 틀린 꼴(정규식 문자열), 바른 꼴, 설명]
  var WORD_FIXES = [
    ['myeochil', '(?<![가-힣])몇일', '며칠',
      "'몇일'이 아니라 '며칠'이 표준어예요. 날짜를 물을 때도, 기간을 말할 때도 언제나 '며칠'로 써요.", "'몇일' → '며칠'"],
    ['eotteokhae', '어떻(?=[해하할합했])', '어떡',
      "'어떡해'는 '어떻게 해'를 줄인 말이에요. '어떻해'라는 말은 없어요. (예: 어떡해요, 어떡하지)"],
    ['wen', '왠(?!지)', '웬',
      "'왠'은 '왠지'(왜인지)에서만 써요. 그 밖에는 모두 '웬'이에요. (예: 웬일, 웬만하면, 웬 사람)"],
    ['waenji', '웬지', '왠지',
      "'왜인지'를 줄인 말이라서 '왠지'로 써요."],
    ['geumse', '금새', '금세',
      "'금시에'가 줄어든 말이라 '금세'로 써요. ('금새'는 물건값이라는 뜻의 다른 말이에요.)"],
    ['ilili', '일일히', '일일이', "'일일이'가 맞아요. 끝소리가 [이]로만 나는 말은 '-이'로 써요."],
    ['kkaekkeusi', '깨끗히', '깨끗이', "'깨끗이'가 맞아요. 'ㅅ' 받침 뒤에서는 '-이'로 써요."],
    ['gomgomi', '곰곰히', '곰곰이', "'곰곰이'가 맞아요. 같은 말이 겹친 낱말 뒤에는 '-이'를 써요."],
    ['teumteumi', '틈틈히', '틈틈이', "'틈틈이'가 맞아요. 같은 말이 겹친 낱말 뒤에는 '-이'를 써요."],
    ['beonbeoni', '번번히', '번번이', "'번번이'가 맞아요. 같은 말이 겹친 낱말 뒤에는 '-이'를 써요."],
    ['kkomkkomhi', '꼼꼼이', '꼼꼼히', "'꼼꼼히'가 맞아요. '-하다'가 붙는 말(꼼꼼하다)은 대개 '-히'로 써요."],
    ['soljikhi', '솔직이', '솔직히', "'솔직히'가 맞아요. '-하다'가 붙는 말(솔직하다)은 대개 '-히'로 써요."],
    ['kkujunhi', '꾸준이', '꾸준히', "'꾸준히'가 맞아요. '-하다'가 붙는 말(꾸준하다)은 대개 '-히'로 써요."],
    ['gakkai', '가까히', '가까이', "'가까이'가 맞아요."],
    ['mani', '많히', '많이', "'많이'가 맞아요."],
    ['ttatteusi', '따뜻히', '따뜻이', "'따뜻이'가 맞아요. 'ㅅ' 받침 뒤에서는 '-이'로 써요."],
    ['beojeosi', '버젓히', '버젓이', "'버젓이'가 맞아요. 'ㅅ' 받침 뒤에서는 '-이'로 써요."],
    ['gipsuki', '깊숙히', '깊숙이', "'깊숙이'가 맞아요."],
    ['neugeusi', '느긋히', '느긋이', "'느긋이'가 맞아요. 'ㅅ' 받침 뒤에서는 '-이'로 써요."],
    ['iljjigi', '일찌기', '일찍이', "'일찍이'가 맞아요. 원래 말(일찍)의 모양을 밝혀 써요."],
    ['deouki', '더우기', '더욱이', "'더욱이'가 맞아요. 원래 말(더욱)의 모양을 밝혀 써요."],
    ['oraenman', '오랫만', '오랜만', "'오래간만'을 줄인 말이라 '오랜만'이에요. (반대로 '오랫동안'은 'ㅅ'을 써요.)"],
    ['oraetdongan', '오랜동안', '오랫동안', "'오랫동안'이 맞아요. (반대로 '오랜만'은 'ㅅ'이 없어요.)"],
    ['huihan', '희안', '희한', "'희한하다'가 맞아요. (드물 희 稀, 드물 한 罕)"],
    ['seolgeoji', '설겆이', '설거지', "'설거지'가 표준어예요."],
    ['yeokhal', '역활', '역할', "'역할(役割)'이 맞아요."],
    ['eoieopda', '어의(?=\\s?(?:없|가 없))', '어이', "'어이없다'가 맞아요. ('어의'는 임금의 의사라는 뜻이에요.)"],
    ['dwaetda', '됬', '됐', "'되었'을 줄이면 '됐'이에요. '됬'이라는 글자는 쓰지 않아요."],
    ['dwaeyo', '되요', '돼요', "'되어요'를 줄이면 '돼요'예요. '되' 자리에 '되어'를 넣어 말이 되면 '돼'로 써요."],
    ['dwaeseo', '되서', '돼서', "'되어서'를 줄이면 '돼서'예요. '되' 자리에 '되어'를 넣어 말이 되면 '돼'로 써요."],
    ['dwaeya', '되야', '돼야', "'되어야'를 줄이면 '돼야'예요. '되' 자리에 '되어'를 넣어 말이 되면 '돼'로 써요."],
    ['dwaebeo', '되버', '돼버', "'되어 버리다'를 줄이면 '돼 버리다(돼버리다)'예요."],
    ['dwaedo', '되도(?!록)', '돼도', "'되어도'를 줄이면 '돼도'예요. ('되도록'은 그대로 써요.)"],
    ['bwaeyo', '뵈요', '봬요', "'뵈어요'를 줄이면 '봬요'예요."],
    ['bwaetda', '뵜', '뵀', "'뵈었'을 줄이면 '뵀'이에요."],
    ['eojjaetdeun', '어쨋든', '어쨌든', "'어쨌든'이 맞아요. ('어찌했든'이 줄어든 말)"],
    ['doenoe', '되뇌이', '되뇌', "'되뇌다'가 기본형이에요. '되뇌이다'는 쓰지 않아요. (예: 되뇌었다, 되뇌는)"],
    ['seolle', '설레이', '설레', "'설레다'가 기본형이에요. (예: 설레는, 설렌다)"],
    ['seollem', '설레임', '설렘', "'설레다'의 명사형은 '설렘'이에요."],
    ['hemae', '헤매이', '헤매', "'헤매다'가 기본형이에요. (예: 헤매는, 헤맸다)"],
    ['naneun', '날으는', '나는', "'날다'는 'ㄹ'이 빠져서 '나는'이 돼요. (예: 하늘을 나는 새)"],
    ['samga', '삼가하', '삼가', "기본형이 '삼가다'라서 '삼가세요, 삼가 주세요'로 써요."],
    ['samga2', '삼가해', '삼가', "기본형이 '삼가다'라서 '삼가 주세요'로 써요."],
    ['jamga1', '잠궜', '잠갔', "기본형이 '잠그다'라서 '잠갔다, 잠가'로 써요."],
    ['jamga2', '잠궈', '잠가', "기본형이 '잠그다'라서 '잠가, 잠갔다'로 써요."],
    ['damga1', '담궜', '담갔', "기본형이 '담그다'라서 '담갔다, 담가'로 써요."],
    ['damga2', '담궈', '담가', "기본형이 '담그다'라서 '담가, 담갔다'로 써요."],
    ['chireo1', '치뤘', '치렀', "기본형이 '치르다'라서 '치렀다, 치러'로 써요."],
    ['chireo2', '치뤄', '치러', "기본형이 '치르다'라서 '치러, 치렀다'로 써요."],
    ['anjeolbujeol', '안절부절하', '안절부절못하', "'안절부절못하다'가 표준어예요. '못'을 빼면 뜻이 반대가 돼요."],
    ['aedangcho', '애시당초', '애당초', "'애당초'가 표준어예요."],
    ['eojjupjan', '어줍잖', '어쭙잖', "'어쭙잖다'가 표준어예요."],
    ['naerora', '내노라', '내로라', "'내로라하다'가 맞아요. ('나로라' 하고 나선다는 뜻)"],
    ['neolbeureo', '널부러', '널브러', "'널브러지다'가 표준어예요."],
    ['dakkdal', '닥달', '닦달', "'닦달하다'가 맞아요."],
    ['dolmengi', '돌맹이', '돌멩이', "'돌멩이'가 표준어예요."],
    ['huirotae', '희노애락', '희로애락', "'희로애락(喜怒哀樂)'이 맞아요. '노'가 '로'로 바뀌어 굳은 말이에요."],
    ['yukgaejang', '육계장', '육개장', "'육개장'이 표준어예요."],
    ['eoribari', '어리버리', '어리바리', "'어리바리하다'가 표준어예요."],
    ['jjagipgi', '짜집기', '짜깁기', "'짜깁기'가 표준어예요."],
    ['tteokbokki', '떡볶기', '떡볶이', "'떡볶이'가 표준어예요."],
    ['gopppaegi', '곱배기', '곱빼기', "'곱빼기'가 표준어예요."],
    ['enganhi', '웬간', '엔간', "'엔간하다(어지간하다)'가 맞아요. 또는 '웬만하다'를 써요."],
    ['aniyeyo', '아니예요', '아니에요', "'아니다' 뒤에는 '-에요'가 붙어 '아니에요'가 돼요."],
    ['anieot', '아니였', '아니었', "'아니-'에 '-었-'이 붙어 '아니었다'가 돼요."],
    ['halgeo', '(?<=(?:을|할|갈|줄|볼|올|될)|(?:할|갈|줄|볼|올|될)\\s)꺼(?=(?:야|예요|에요|다|라|지|든|니|면|고|요|였|같))', '거',
      "'것'을 편하게 말한 '거'는 소리가 [꺼]로 나도 '거'로 써요. (예: 할 거야)"],
    ['halgeol', '(?<=(?:을|할|갈|줄|볼|올|될))껄', '걸',
      "'-ㄹ걸'은 소리가 [껄]로 나도 '걸'로 써요. (예: 그럴걸, 할걸)"],
    ['deunji', '던지 말던지', '든지 말든지',
      "고르는 뜻일 때는 '-든지'를 써요. '-던지'는 지난 일을 떠올릴 때 써요. (예: 가든지 말든지 / 얼마나 춥던지)"],
    ['itseum', '(?<=[있없했았었겠])슴(?![가-힣])', '음',
      "명사형은 '-음'이에요. (예: 있음, 없음, 했음) '-습니다'와 헷갈리기 쉬워요."]
  ];
  var TITLES = {
    eotteokhae: "'어떻해' → '어떡해'", wen: "'왠' → '웬'", halge: "'-ㄹ께' → '-ㄹ게'",
    halgeo: "'-ㄹ 꺼' → '-ㄹ 거'", halgeol: "'-ㄹ껄' → '-ㄹ걸'", itseum: "'-슴' → '-음'",
    dwaeyo: '되/돼 구별', dwaeseo: '되/돼 구별', dwaeya: '되/돼 구별', dwaebeo: '되/돼 구별',
    dwaedo: '되/돼 구별', dwaetda: '되/돼 구별', deunji: "'-든지'와 '-던지'"
  };
  WORD_FIXES.forEach(function (w) {
    var title = w[4] || TITLES[w[0]] || ("바른 표기: '" + w[2] + "'");
    simple(w[0], 'spell', 'error', title, w[3], new RegExp(w[1], 'g'), function () { return w[2]; });
  });

  addRule({
    id: 'myeochil-sp', cat: 'spell', level: 'check', title: "'몇 일' → '며칠'?",
    explain: "날짜나 기간을 말하는 거라면 '며칠'이 표준어예요(며칠 동안, 오늘이 며칠이지?). '몇 가지 일'이라는 뜻이라면 그대로 두세요.",
    re: /(?<![가-힣])몇 일(?=[\s.,!?…"'”’)]|$|이|에|간|째|동안|까지|만에|전|후)/gm,
    fix: function () { return '며칠'; }
  });

  // -ㄹ께 → -ㄹ게: 앞 글자 받침이 ㄹ이고 문장이 끝나는 자리.
  // '부모님들께, 딸께'처럼 높임 조사 '께'는 제외한다.
  addRule({
    id: 'halge', cat: 'spell', level: 'error', title: "'-ㄹ께' → '-ㄹ게'",
    explain: "'-ㄹ게(요)'는 소리가 [께]로 나도 '게'로 써요. (예: 할게요, 갈게, 남길게)",
    re: /([가-힣])께(?=요?(?:[\s.,!?…~"'”’)]|$))/gm,
    pick: function (m) {
      if (jong(m[1]) !== 8 || /[들딸]/.test(m[1])) return null;
      return { start: m.index + 1, end: m.index + 2, suggestion: '게' };
    }
  });

  // 돼 → 되 ('돼지'는 동물일 수 있어서 건드리지 않음)
  simple('dwae2doe', 'spell', 'error', '되/돼 구별',
    "'돼'는 '되어'를 줄인 말이에요. 여기는 '되어'를 넣으면 말이 안 되므로 '되'로 써요. (예: 되는, 되면, 되고)",
    /돼(?=는|면|고|었|어|기|게|니|며|도록|던)/g, function () { return '되'; });

  // 문장 끝 '되.' → '돼.'  (드물게 '한 되'처럼 단위일 수 있어 확인 필요)
  addRule({
    id: 'doe-end', cat: 'spell', level: 'check', title: '되/돼 구별 (문장 끝)',
    explain: "문장을 끝낼 때는 '되어'를 줄인 '돼'를 써요. (예: 그러면 돼. 안 돼!) 곡식을 재는 단위 '되'라면 그대로 두세요.",
    re: /(?<=[가-힣\s])되(?=[.!?…]|$)/gm,
    pick: function (m) { return { start: m.index, end: m.index + 1, suggestion: '돼' }; }
  });

  // 않 → 안 ('않'은 '아니하'의 준말이라 바로 뒤에 동사가 올 수 없음)
  addRule({
    id: 'anh2an', cat: 'spell', level: 'error', title: "'않' → '안'",
    explain: "'안'은 '아니'의 준말로 동사 앞에 와요(안 가다, 안 했다). '않'은 '아니하'의 준말로 '-지 않다'처럼 뒤에 붙어요.",
    re: /않\s?(?=하|해|했|한다|할|돼|되|된|될|가(?![요나])|갔|와|왔|먹|보|봐|봤|좋|싫|써|쓰)/g,
    pick: function (m) { return { start: m.index, end: m.index + m[0].length, suggestion: '안 ' }; }
  });
  // -지 안았다 → -지 않았다
  addRule({
    id: 'an2anh', cat: 'spell', level: 'error', title: "'안' → '않'",
    explain: "'-지' 뒤에는 '아니하다'의 준말 '않다'를 써요. (예: 가지 않았다, 먹지 않습니다)",
    re: /(?<=[가-힣]지\s?)안(?=았|습|겠|는다)/g,
    pick: function (m) { return { start: m.index, end: m.index + 1, suggestion: '않' }; }
  });
  addRule({
    id: 'an2anh-check', cat: 'spell', level: 'check', title: "'안' → '않'?",
    explain: "'-지' 뒤에서 '아니하다'를 뜻한다면 '않'으로 써요. (예: 가지 않아, 먹지 않고) 품에 '안다'라는 뜻이라면 그대로 두세요.",
    re: /(?<=[가-힣]지\s)안(?=아|고|은|을)/g,
    pick: function (m) { return { start: m.index, end: m.index + 1, suggestion: '않' }; }
  });

  // 받침 + 이였다 → 이었다 / 받침 + 이예요 → 이에요
  addRule({
    id: 'ieot', cat: 'spell', level: 'error', title: "'이였' → '이었'",
    explain: "받침 있는 말 뒤에는 '이었다'를 써요(사람이었다). 받침 없는 말 뒤에는 줄여서 '였다'를 써요(친구였다).",
    re: /([가-힣])이였/g,
    pick: function (m) {
      if (!hasBatchim(m[1])) return null;
      return { start: m.index + 1, end: m.index + 3, suggestion: '이었' };
    }
  });
  addRule({
    id: 'ieyo', cat: 'spell', level: 'error', title: "'이예요' → '이에요'",
    explain: "받침 있는 말 뒤에는 '이에요'를 써요(책이에요). 받침 없는 말 뒤에는 '예요'를 써요(나무예요).",
    re: /([가-힣])이예요/g,
    pick: function (m) {
      if (!hasBatchim(m[1])) return null;
      return { start: m.index + 1, end: m.index + 4, suggestion: '이에요' };
    }
  });

  // -ㄹ려고 → -려고
  addRule({
    id: 'ryeogo', cat: 'spell', level: 'error', title: "'-ㄹ려고' → '-려고'",
    explain: "'-려고' 앞에 'ㄹ'을 덧붙이지 않아요. (예: 하려고, 먹으려고, 보려면)",
    re: /(할|을|볼|줄|될)려(?=고|면|는|던|다가)/g,
    pick: function (m) {
      var map = { '할': '하', '을': '으', '볼': '보', '줄': '주', '될': '되' };
      return { start: m.index, end: m.index + 2, suggestion: map[m[1]] + '려' };
    }
  });

  // -함으로서 → -함으로써 (방법·수단)
  addRule({
    id: 'eurosseo', cat: 'spell', level: 'error', title: "'-ㅁ으로서' → '-ㅁ으로써'",
    explain: "'(으)로써'는 수단·방법(~을 가지고), '(으)로서'는 자격·신분(~의 입장에서)이에요. '~함으로' 뒤는 '~해서'라는 뜻이라 '써'가 맞아요.",
    re: /(?<=[함됨])으로서/g,
    fix: function () { return '으로써'; }
  });
  addRule({
    id: 'roseo', cat: 'spell', level: 'check', title: "'로써' → '로서'?",
    explain: "사람의 자격이나 신분을 말할 때는 '로서'를 써요. (예: 엄마로서, 작가로서) '로써'는 '~을 가지고'라는 수단의 뜻이에요.",
    re: /(사람|엄마|아빠|어머니|아버지|부모|자식|딸|아들|친구|작가|선생|선생님|학생|교사|어른|아이|입장|자격|신분|가장|남편|아내|인간|여자|남자|딸로|직장인|사회인|국민|시민|이웃|동료|선배|후배)(으)?로써/g,
    pick: function (m) {
      var s = m.index + m[1].length;
      return { start: s, end: m.index + m[0].length, suggestion: (m[2] || '') + '로서' };
    }
  });

  // 문맥 의존 — 확인 필요
  addRule({
    id: 'baram', cat: 'spell', level: 'check', title: "'바래' → '바라'?",
    explain: "'원하다'라는 뜻이면 기본형이 '바라다'라서 '바라요, 바랐다, 바람'으로 써요. 색이 '바래다(빛이 옅어지다)'라면 그대로 두세요.",
    re: /바(래요|랬|램)/g,
    pick: function (m) {
      var map = { '래요': '라요', '랬': '랐', '램': '람' };
      return { start: m.index, end: m.index + m[0].length, suggestion: '바' + map[m[1]] };
    }
  });
  addRule({
    id: 'ilbureo', cat: 'spell', level: 'check', title: "'일부로' → '일부러'?",
    explain: "'고의로, 굳이'라는 뜻이면 '일부러'예요. '전체 중 한 부분으로'라는 뜻이면 '일부로'가 맞아요.",
    re: /(?<![가-힣]\s?의\s?)(?<![가-힣])일부로(?![가-힣])/g,
    fix: function () { return '일부러'; }
  });
  addRule({
    id: 'gutji', cat: 'spell', level: 'check', title: "'구지' → '굳이'?",
    explain: "'고집을 부려 구태여'라는 뜻이면 '굳이'로 써요(소리는 [구지]).",
    re: /(?<![가-힣])구지(?![가-힣])/g,
    fix: function () { return '굳이'; }
  });
  addRule({
    id: 'anduae', cat: 'spell', level: 'check', title: "'안돼' 띄어쓰기",
    explain: "'하면 안 된다(금지)'라는 뜻이면 '안 돼'처럼 띄어 써요. '안되다'를 붙여 쓰는 건 '안타깝다(얼굴이 안돼 보여)'나 '잘되지 않다(일이 안돼서)'라는 뜻일 때뿐이에요.",
    re: /(?<![가-힣])안(?=(?:돼|되)(?:요|[.!?…]|$))/gm,
    fix: function () { return '안 '; }
  });
  addRule({
    id: 'machuda', cat: 'spell', level: 'check', title: "'맞추다' → '맞히다'?",
    explain: "정답을 골라내는 것은 '맞히다'예요. '맞추다'는 둘을 서로 비교하거나 어긋나지 않게 하는 거예요(답을 맞춰 보다).",
    re: /(?<=(?:정답|답|문제|퀴즈)(?:을|를)\s)맞추/g,
    fix: function () { return '맞히'; }
  });

  // ════════════════════════════════════════════
  // 2. 띄어쓰기 — 의존명사 일부 (확실한 형태만)
  // ════════════════════════════════════════════
  // 관형형 어미로 끝나는 음절. ADN_SURE는 명사 끝과 헷갈릴 일이 드문 것만,
  // ADN_MAYBE는 명사(시인, 일본, 원한, 행운…)일 수도 있어 '확인 필요'로만 표시한다.
  var ADN_SURE = '(?:는|던|(?<!역|관)할|(?<![마가노고])을|될|된|볼)';
  var ADN_MAYBE = '(?:한|인|은|본|운)';
  var ADN = '(?:' + ADN_SURE + '|' + ADN_MAYBE + ')';
  var NOUN_NOTE = ' 앞말이 명사(시인, 일본, 행운 등)라면 붙여 쓰는 게 맞으니 그대로 두세요.';

  addRule({
    id: 'sp-su', cat: 'space', level: 'error', title: "'수'는 띄어 써요",
    explain: "'할 수 있다'의 '수'는 앞말에 기대어 쓰는 명사(의존명사)라 띄어 써요. (예: 할 수 있다, 갈 수밖에) '갈수록'은 한 덩어리라 붙여 써요.",
    re: /([가-힣])수(\s?)(있|없|밖에|도(?=\s?[있없]))/g,
    pick: function (m) {
      if (jong(m[1]) !== 8) return null; // 앞 글자 받침이 ㄹ일 때만 (할, 갈, 먹을…)
      var s = m.index + 1;
      var after = m[3] === '있' || m[3] === '없' ? ' ' : '';
      return { start: s, end: s + 1 + m[2].length, suggestion: ' 수' + after };
    }
  });
  addRule({
    id: 'sp-su2', cat: 'space', level: 'error', title: "'수 있다' 띄어쓰기",
    explain: "'수'와 '있다/없다'는 서로 다른 낱말이라 띄어 써요. (예: 할 수 있다)",
    re: /([가-힣]) 수(있|없)/g,
    pick: function (m) {
      if (jong(m[1]) !== 8) return null;
      var s = m.index + 2;
      return { start: s, end: s + 1, suggestion: '수 ' };
    }
  });
  addRule({
    id: 'sp-geot', cat: 'space', level: 'error', title: "'것'은 띄어 써요",
    explain: "'것'은 앞말에 기대어 쓰는 명사(의존명사)라 띄어 써요. (예: 먹는 것, 좋은 것, 할 것이다) '이것, 그것, 아무것'은 한 낱말이라 붙여 써요.",
    re: new RegExp(ADN + '것', 'g'),
    pick: function (m) { return { start: m.index + m[0].length - 1, end: m.index + m[0].length - 1, suggestion: ' ' }; }
  });
  var DEP_NOUNS = [
    ['sp-de', '데', '(?=에|를)', "'데' 띄어쓰기",
      "'곳, 일, 경우'라는 뜻의 '데'는 띄어 써요(가는 데에, 아픈 데를). 뒤 내용을 잇는 '-는데'(비가 오는데)는 붙여 써요. 뒤에 '에, 를'이 붙어 있으면 대개 띄어 쓰는 '데'예요.", true],
    ['sp-mankeum', '만큼', '', "'만큼' 띄어쓰기",
      "동사·형용사 뒤에 오는 '만큼'은 띄어 써요(먹을 만큼, 노력한 만큼). 명사 바로 뒤에서는 붙여 써요(너만큼, 하늘만큼)."],
    ['sp-ppun', '뿐', '(?!더러)', "'뿐' 띄어쓰기",
      "동사·형용사 뒤에 오는 '뿐'은 띄어 써요(웃을 뿐, 들었을 뿐). 명사 바로 뒤에서는 붙여 써요(너뿐). '-ㄹ뿐더러'는 붙여 써요."],
    ['sp-deut', '듯', '', "'듯' 띄어쓰기",
      "'-는/-ㄴ/-ㄹ' 뒤에 오는 '듯'은 띄어 써요(비가 올 듯, 아는 듯이). 동사 줄기에 바로 붙는 '-듯'(물 쓰듯)은 붙여 써요."]
  ];
  DEP_NOUNS.forEach(function (d) {
    var insertSpace = function (m) { return { start: m.index + m[0].length - d[1].length, end: m.index + m[0].length - d[1].length, suggestion: ' ' }; };
    addRule({ id: d[0], cat: 'space', level: d[5] ? 'check' : 'error', title: d[3], explain: d[4],
      re: new RegExp(ADN_SURE + d[1] + d[2], 'g'), pick: insertSpace });
    addRule({ id: d[0] + '-maybe', cat: 'space', level: 'check', title: d[3] + '?', explain: d[4] + NOUN_NOTE,
      re: new RegExp(ADN_MAYBE + d[1] + d[2], 'g'), pick: insertSpace });
  });
  addRule({
    id: 'sp-ttaemun', cat: 'space', level: 'error', title: "'때문'은 띄어 써요",
    explain: "'때문'은 의존명사라 언제나 앞말과 띄어 써요. (예: 너 때문에, 그렇기 때문에)",
    re: /([가-힣])때문/g,
    pick: function (m) { return { start: m.index + 1, end: m.index + 1, suggestion: ' ' }; }
  });

  // ════════════════════════════════════════════
  // 3. 문장부호
  // ════════════════════════════════════════════
  addRule({
    id: 'pu-space-before', cat: 'punct', level: 'error', title: '문장부호 앞 빈칸',
    explain: '마침표, 쉼표, 물음표, 느낌표는 앞 글자에 바로 붙여 써요.',
    re: /(?<=[가-힣]) +(?=[.,!?](?!\.))/g,
    fix: function () { return ''; }
  });
  addRule({
    id: 'pu-space-after', cat: 'punct', level: 'error', title: '문장부호 뒤 빈칸',
    explain: '쉼표, 마침표, 물음표, 느낌표 다음에 글이 이어지면 한 칸 띄어요.',
    re: /(?<=[가-힣][.,!?])(?=[가-힣])/g,
    pick: function (m) { return { start: m.index, end: m.index, suggestion: ' ' }; }
  });
  addRule({
    id: 'pu-multispace', cat: 'punct', level: 'error', title: '빈칸이 두 개 이상',
    explain: '낱말 사이는 한 칸만 띄어요. 빈칸이 여러 개 들어가 있어요.',
    re: /(?<=\S) {2,}(?=\S)/g,
    fix: function () { return ' '; }
  });
  addRule({
    id: 'pu-double-period', cat: 'punct', level: 'check', title: '마침표가 두 개',
    explain: '마침표를 실수로 두 번 찍은 것 같아요. 말을 줄이려던 것이라면 말줄임표(……)를 쓰세요.',
    re: /(?<!\.)\.\.(?!\.)/g,
    fix: function () { return '.'; }
  });
  addRule({
    id: 'pu-q-period', cat: 'punct', level: 'check', title: '물음표·느낌표 뒤 마침표',
    explain: '물음표나 느낌표가 이미 문장을 끝냈으므로 뒤에 마침표를 또 찍지 않아요.',
    re: /(?<=[?!])\.(?!\.)/g,
    fix: function () { return ''; }
  });

  // 따옴표 짝 (문단 단위로 검사)
  function quotePairs(text, out) {
    var paraRe = /[^\n]+/g, p;
    while ((p = paraRe.exec(text))) {
      var s = p[0], base = p.index, stack = [], i, ch;
      var pairs = { '“': '”', '‘': '’' };
      var closers = { '”': '“', '’': '‘' };
      var straight = [], straightS = [];
      for (i = 0; i < s.length; i++) {
        ch = s[i];
        if (pairs[ch]) stack.push({ ch: ch, i: i });
        else if (closers[ch]) {
          if (stack.length && stack[stack.length - 1].ch === closers[ch]) stack.pop();
          else if (ch === '’' && /[A-Za-z]/.test(s[i - 1] || '')) { /* 영어 아포스트로피 */ }
          else out.push(mk('pu-quote', 'punct', 'check', '따옴표 짝이 안 맞아요',
            "닫는 따옴표(" + ch + ")가 있는데 이 문단에 여는 따옴표(" + closers[ch] + ")가 없어요. 빠뜨렸거나 다른 문단에 있는지 확인하세요.",
            base + i, base + i + 1, s[i], null));
        } else if (ch === '"') straight.push(i);
        else if (ch === "'" && !/[A-Za-z]/.test(s[i - 1] || '')) straightS.push(i);
      }
      stack.forEach(function (o) {
        out.push(mk('pu-quote', 'punct', 'check', '따옴표 짝이 안 맞아요',
          "여는 따옴표(" + o.ch + ")가 이 문단 안에서 닫히지 않았어요. 닫는 따옴표(" + pairs[o.ch] + ")를 빠뜨리지 않았는지 확인하세요.",
          base + o.i, base + o.i + 1, o.ch, null));
      });
      if (straight.length % 2 === 1) {
        var k = straight[straight.length - 1];
        out.push(mk('pu-quote', 'punct', 'check', '따옴표 짝이 안 맞아요',
          '곧은 큰따옴표(")가 이 문단에 홀수 개 있어요. 하나를 빠뜨렸을 수 있어요.',
          base + k, base + k + 1, '"', null));
      }
      if (straightS.length % 2 === 1) {
        var k2 = straightS[straightS.length - 1];
        out.push(mk('pu-quote', 'punct', 'check', '따옴표 짝이 안 맞아요',
          "곧은 작은따옴표(')가 이 문단에 홀수 개 있어요. 하나를 빠뜨렸을 수 있어요.",
          base + k2, base + k2 + 1, "'", null));
      }
    }
  }

  // 따옴표 모양 통일: 곧은(") 따옴표와 둥근(“”) 따옴표가 섞였을 때
  function quoteStyle(text, out, opts) {
    var pref = opts.quoteStyle; // 'curly' | 'straight' | undefined
    if (!pref) return;
    var re = pref === 'curly' ? /["']/g : /[“”‘’]/g, m;
    while ((m = re.exec(text))) {
      var ch = m[0], i = m.index, sug;
      if (pref === 'curly') {
        if (ch === "'" && /[A-Za-z]/.test(text[i - 1] || '')) continue;
        var prev = text[i - 1];
        var opening = !prev || /[\s(\[{<「『—–-]/.test(prev);
        sug = ch === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’');
      } else {
        sug = (ch === '“' || ch === '”') ? '"' : "'";
      }
      out.push(mk('pu-quote-style', 'punct', 'error', '따옴표 모양 통일',
        '원고 안에 곧은 따옴표(" \')와 둥근 따옴표(“ ” ‘ ’)가 섞여 있어요. 더 많이 쓴 ' +
        (pref === 'curly' ? '둥근' : '곧은') + ' 따옴표로 맞추면 책이 깔끔해 보여요. (설정에서 바꿀 수 있어요)',
        i, i + 1, ch, sug));
    }
  }

  // 말줄임표 통일
  var ELLIPSIS_STYLES = { '……': '……', '…': '…', '...': '...', '......': '......' };
  function ellipsisKind(tok) { return ELLIPSIS_STYLES[tok] || 'other'; }
  function ellipsisCheck(text, out, opts) {
    var pref = opts.ellipsis;
    var re = /…+|\.{3,}/g, m;
    while ((m = re.exec(text))) {
      var kind = ellipsisKind(m[0]);
      if (kind === 'other') {
        out.push(mk('pu-ellipsis', 'punct', 'check', '말줄임표 모양',
          "점이나 말줄임표의 개수가 정해진 모양이 아니에요. 표준은 '……'(가운데 점 여섯 개)이고, '…', '...', '......'도 허용돼요.",
          m.index, m.index + m[0].length, m[0], pref || '……'));
      } else if (pref && kind !== pref) {
        out.push(mk('pu-ellipsis', 'punct', 'error', '말줄임표 통일',
          "원고 안에서 말줄임표를 여러 모양으로 쓰고 있어요. 한 가지('" + pref + "')로 맞추면 책이 깔끔해 보여요. (설정에서 고를 수 있어요)",
          m.index, m.index + m[0].length, m[0], pref));
      }
    }
  }

  // ════════════════════════════════════════════
  // 4. 문장 다듬기 (윤문) — 틀린 건 아니지만 참고
  // ════════════════════════════════════════════
  var STYLE_PATTERNS = [
    ['tr-geosida', /(?<=[는은던할을]\s)것이다(?=[.!?…"”’]|$)/gm, "'~것이다'로 끝나는 문장",
      "'~하는 것이다'는 영어·일본어 번역 글에서 흔한 말투예요. '~한다', '~이다'처럼 바로 끝내면 문장이 단단해져요. (예: 사랑하는 것이다 → 사랑한다) 강조하려는 뜻이라면 그대로 두어도 돼요."],
    ['tr-eitsseo', /에 있어서?(?=[\s,])/g, "'~에 있어(서)'",
      "'~에 있어서'는 일본어 번역투예요. '~에서', '~에게', '~할 때'로 바꾸면 자연스러워요. (예: 인생에 있어서 → 인생에서)"],
    ['tr-gajida', /(?<=[가-힣](?:을|를)\s)(?:가지(?:고 있|다|고|는|게|며)|가진다|가졌|갖고 있|갖는)/g, "'~을 가지다'",
      "'관심을 가지다, 의미를 가지다'는 영어 have를 옮긴 말투예요. '관심이 있다, 뜻이 있다, 의미가 있다'처럼 쓰면 우리말답게 읽혀요. 물건을 실제로 지닌 거라면 그대로 두세요."],
    ['tr-euihae', /에 의(?:해서?|한)(?![가-힣])/g, "'~에 의해'",
      "'~에 의해'는 번역투 피동문에서 자주 나와요. 행동한 사람을 주어로 세우면 문장이 살아나요. (예: 그에 의해 쓰인 책 → 그가 쓴 책)"],
    ['tr-robuteo', /(?<=[가-힣])(?:으)?로부터/g, "'~로부터'",
      "'~로부터'는 영어 from을 옮긴 말투일 때가 많아요. 사람이면 '~에게서', 장소면 '~에서'로 바꿔 보세요. (예: 친구로부터 들었다 → 친구에게서 들었다)"],
    ['tr-anheumyeon', /지 않으면 안 ?(?:된|돼|되)/g, "'~지 않으면 안 된다'",
      "이중 부정은 일본어 번역투예요. '~해야 한다'로 쓰면 간결해요."],
    ['tr-piryo', /(?:을|를) 필요로 (?:하|한|했)/g, "'~을 필요로 하다'",
      "영어 need를 옮긴 말투예요. '~이 필요하다'로 쓰면 자연스러워요."],
    ['tr-bulguhago', /에도 불구하고/g, "'~에도 불구하고'",
      "'불구하고'는 빼도 뜻이 같아요. (예: 그럼에도 불구하고 → 그런데도/그럼에도, 비가 옴에도 불구하고 → 비가 오는데도)"],
    ['tr-hana', /(?:가장|제일) [^.!?\n]{1,25}(?:중|가운데)(?:의)? 하나/g, "'가장 ~ 중 하나'",
      "영어 'one of the most'를 옮긴 말투예요. '손꼽히는 ~', '매우 ~한' 등으로 바꾸거나, 정말 하나를 고를 수 있다면 '가장 ~한'만 써 보세요."],
    ['tr-teullim', /임에 (?:틀림|분명)/g, "'~임에 틀림없다'",
      "번역투 표현이에요. '틀림없이 ~이다', '~이 분명하다'로 바꾸면 자연스러워요."],
    ['tr-dareum', /에 다름 아니/g, "'~에 다름 아니다'",
      "일본어 번역투예요. '바로 ~이다', '~와 다르지 않다'로 쓰세요."],
    ['tr-wichi', /에 위치(?:한|하|해|했)/g, "'~에 위치하다'",
      "'~에 있다'로 바꾸면 쉽고 자연스러워요."],
    ['tr-jung', /(?<=[가-힣]는\s)중이(?:다|었다|에요|야)/g, "'~하는 중이다'",
      "영어 진행형(-ing)을 옮긴 말투일 때가 많아요. '~하고 있다'나 그냥 '~한다'로 써 보세요."],
    ['tr-ui', /(?:[가-힣]+의 ){2,}[가-힣]+/g, "'의'가 겹쳐요",
      "'의'를 여러 번 이어 쓰면 문장이 딱딱해져요. 하나를 빼거나 풀어 써 보세요. (예: 나의 어머니의 고향 → 어머니 고향)"]
  ];
  STYLE_PATTERNS.forEach(function (p) {
    addRule({ id: p[0], cat: 'style', level: 'style', title: p[2], explain: p[3], re: p[1] });
  });

  // 이중 피동 (보여지다, 잊혀지다 …) — 고쳐 쓸 말 제안
  var FAMILY = {
    i: { '지': '이', '진': '인', '질': '일', '졌': '였', '져': '여' },
    hi: { '지': '히', '진': '힌', '질': '힐', '졌': '혔', '져': '혀' },
    ri: { '지': '리', '진': '린', '질': '릴', '졌': '렸', '져': '려' },
    gi: { '지': '기', '진': '긴', '질': '길', '졌': '겼', '져': '겨' },
    doe: { '지': '', '진': 'ㄴ', '질': 'ㄹ', '졌': '었', '져': '어' }
  };
  var DOUBLE_PASSIVE = [
    ['보여', '보', 'i'], ['쓰여', '쓰', 'i'], ['놓여', '놓', 'i'],
    ['잊혀', '잊', 'hi'], ['읽혀', '읽', 'hi'], ['닫혀', '닫', 'hi'], ['잡혀', '잡', 'hi'], ['먹혀', '먹', 'hi'], ['갇혀', '갇', 'hi'],
    ['불려', '불', 'ri'], ['열려', '열', 'ri'], ['풀려', '풀', 'ri'], ['팔려', '팔', 'ri'],
    ['믿겨', '믿', 'gi'], ['쫓겨', '쫓', 'gi'],
    ['되어', '되', 'doe']
  ];
  addRule({
    id: 'double-passive', cat: 'style', level: 'check', title: '피동 표현이 겹쳐요',
    explain: "'보이다, 잊히다, 되다'는 이미 '당하는' 뜻을 가진 말이에요. 여기에 '-어지다'를 또 붙이면 피동이 두 번 겹쳐요. (예: 보여지다 → 보이다, 잊혀지다 → 잊히다, 생각되어지다 → 생각되다)",
    re: new RegExp('(' + DOUBLE_PASSIVE.map(function (d) { return d[0]; }).join('|') + ')(지|진|질|졌|져)', 'g'),
    pick: function (m) {
      var d = DOUBLE_PASSIVE.filter(function (x) { return x[0] === m[1]; })[0];
      var tail = FAMILY[d[2]][m[2]];
      var sug;
      if (d[2] === 'doe') {
        sug = tail === 'ㄴ' ? '된' : tail === 'ㄹ' ? '될' : '되' + tail;
      } else sug = d[1] + tail;
      return { start: m.index, end: m.index + m[0].length, suggestion: sug };
    }
  });

  // ── 공통: 지적 하나 만들기 ──
  function mk(ruleId, cat, level, title, explain, start, end, original, suggestion) {
    return { ruleId: ruleId, cat: cat, level: level, title: title, explain: explain,
      start: start, end: end, original: original, suggestion: suggestion };
  }

  // ── 문장 나누기 ──
  function sentences(text) {
    var out = [], re = /[^\n.!?…]*(?:[.!?…]+["”’'」』)]*|$)/g, m;
    var paraRe = /[^\n]+/g, p;
    while ((p = paraRe.exec(text))) {
      var s = p[0];
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        if (m[0] === '') { re.lastIndex++; if (re.lastIndex > s.length) break; continue; }
        var lead = m[0].match(/^\s*/)[0].length;
        var body = m[0].slice(lead);
        if (body.replace(/\s/g, '').length) out.push({ start: p.index + m.index + lead, end: p.index + m.index + m[0].length, text: body, para: p.index });
      }
    }
    return out;
  }

  // 긴 문장
  function longSentences(text, out, opts) {
    var max = opts.longSentence || 80;
    sentences(text).forEach(function (s) {
      var len = s.text.trim().length;
      if (len > max) {
        out.push(mk('long-sentence', 'style', 'style', '긴 문장 (' + len + '자)',
          '한 문장이 ' + len + '자예요(기준 ' + max + '자). 긴 문장은 읽다가 길을 잃기 쉬워요. 쉼표나 \'~고\', \'~며\', \'~는데\'가 있는 곳에서 두 문장으로 나눠 보세요. 일부러 길게 쓴 문장이라면 그대로 두어도 돼요.',
          s.start, s.start + s.text.trimEnd().length, s.text, null));
      }
    });
  }

  // 같은 문장 끝맺음이 연달아 반복
  function endingRepeat(text, out, opts) {
    var n = opts.endingRepeat || 3;
    var list = sentences(text);
    var run = [], last = null;
    function flush() {
      if (run.length >= n) {
        for (var k = n - 1; k < run.length; k++) {
          var s = run[k];
          out.push(mk('ending-repeat', 'style', 'style', "'~" + last + "' 끝맺음 반복",
            "'~" + last + "'(으)로 끝나는 문장이 " + run.length + "번 이어져요. 끝맺음이 같으면 글의 리듬이 단조로워져요. 몇 문장을 합치거나 끝을 바꿔 보세요.",
            s.endPos - last.length, s.endPos, last, null));
        }
      }
    }
    list.forEach(function (s) {
      var t = s.text.replace(/[.!?…"”’'」』)\s]+$/, '');
      var tail = t.slice(-2);
      if (!/^[가-힣]{2}$/.test(tail)) { flush(); run = []; last = null; return; }
      s.endPos = s.start + t.length;
      if (tail === last) run.push(s);
      else { flush(); run = [s]; last = tail; }
    });
    flush();
  }

  // 한 문단 안에서 같은 낱말 반복
  var JOSA = ['에서는', '에게서', '으로는', '으로써', '으로서', '에서도', '에게는', '이라는', '라는', '에서', '에게', '으로', '까지', '부터', '처럼', '보다', '마저', '조차', '이나', '이란', '이라', '이고', '이며', '이다', '하고', '와', '과', '은', '는', '이', '가', '을', '를', '에', '의', '도', '만', '로', '랑', '야'];
  var STOP = {};
  ('그리고 그러나 하지만 그런데 그래서 그러면 그러니까 그렇게 이렇게 저렇게 우리 우리가 그것 이것 저것 때문 정말 너무 아주 그냥 지금 다시 모두 모든 어떤 이런 그런 저런 같은 많은 있다 없다 했다 한다 하는 있는 없는 했던 하고 하며 하면 해서 되는 되어 된다 됐다 같다 같이 '+
    '것이 것은 것을 것도 수가 수도 나는 내가 너는 그는 그녀 그날 오늘 이제 아직 바로 조금 거의 함께 무엇 누구 언제 어디 어떻게 자신 스스로 마음 생각').split(' ').forEach(function (w) { STOP[w] = 1; });
  function stem(w) {
    for (var i = 0; i < JOSA.length; i++) {
      var j = JOSA[i];
      if (w.length - j.length >= 2 && w.slice(-j.length) === j) return w.slice(0, -j.length);
    }
    return w;
  }
  function wordRepeat(text, out, opts) {
    var min = opts.repeatMin || 3;
    var paraRe = /[^\n]+/g, p;
    while ((p = paraRe.exec(text))) {
      var map = {}, wr = /[가-힣]{2,}/g, w;
      while ((w = wr.exec(p[0]))) {
        var st = stem(w[0]);
        if (st.length < 2 || STOP[st] || STOP[w[0]]) continue;
        (map[st] = map[st] || []).push({ i: p.index + w.index, len: w[0].length, word: w[0] });
      }
      Object.keys(map).forEach(function (k) {
        var occ = map[k];
        if (occ.length < min) return;
        for (var n = 1; n < occ.length; n++) {
          out.push(mk('word-repeat', 'style', 'style', "'" + k + "' 반복 (이 문단 " + occ.length + '번)',
            "한 문단에 '" + k + "'(이)라는 말이 " + occ.length + "번 나와요. 일부러 되풀이한 게 아니라면 빼거나 다른 말(대명사, 비슷한 말)로 바꿔 보세요.",
            occ[n].i, occ[n].i + k.length, k, null));
        }
      });
    }
  }

  // ════════════════════════════════════════════
  // 5. 표기 통일 — 사용자 표기 사전 + 기본 외래어 목록
  // ════════════════════════════════════════════
  var LOANWORDS = [
    ['콘텐츠', '컨텐츠'], ['메시지', '메세지'], ['액세서리', '악세사리,악세서리,액세사리'], ['렌터카', '렌트카'],
    ['주스', '쥬스'], ['케이크', '케잌,케익'], ['파이팅', '화이팅'], ['선글라스', '썬글라스'], ['소파', '쇼파'],
    ['카페', '까페'], ['비스킷', '비스켓'], ['초콜릿', '쵸콜렛,초콜렛,쵸콜릿'], ['로봇', '로보트'], ['바비큐', '바베큐'],
    ['플래카드', '플랭카드,플랑카드'], ['리더십', '리더쉽'], ['워크숍', '워크샵'], ['스케줄', '스케쥴'], ['프레젠테이션', '프리젠테이션'],
    ['팸플릿', '팜플렛,팜플릿'], ['리포트', '레포트'], ['타깃', '타겟'], ['비전', '비젼'], ['텔레비전', '텔레비젼'],
    ['콘셉트', '컨셉트,컨셉'], ['매뉴얼', '메뉴얼'], ['앰뷸런스', '앰블런스,엠뷸런스'], ['카디건', '가디건'], ['돈가스', '돈까스'],
    ['라이선스', '라이센스'], ['러닝', '런닝'], ['서비스', '써비스'], ['마사지', '맛사지'], ['데뷔', '데뷰'],
    ['주얼리', '쥬얼리'], ['난센스', '넌센스'], ['심포지엄', '심포지움'], ['알코올', '알콜'], ['에어컨', '에어콘'],
    ['가톨릭', '카톨릭'], ['엔도르핀', '엔돌핀'], ['콩트', '꽁트'], ['앙코르', '앵콜,앵코르'], ['소시지', '소세지'],
    ['미스터리', '미스테리'], ['비즈니스', '비지니스'], ['세팅', '셋팅'], ['스티로폼', '스티로폴'], ['슈퍼', '수퍼'],
    ['배터리', '밧데리,바테리'], ['뷔페', '부페'], ['재킷', '자켓'], ['커튼', '커텐'], ['플래시', '플래쉬,후레쉬'],
    ['내레이션', '나레이션'], ['다이내믹', '다이나믹'], ['깁스', '기브스'], ['로열', '로얄'], ['아웃렛', '아울렛'],
    ['캐럴', '캐롤'], ['에피소드', '에피소우드'], ['도넛', '도너츠,도우넛'], ['샐러드', '사라다'], ['컬렉션', '콜렉션'],
    ['요구르트', '요쿠르트,야쿠르트'], ['애드리브', '애드립'], ['쿠션', '쿳션'], ['팬티', '빤스']
  ];
  function buildTerms(opts) {
    var list = [];
    (opts.dictionary || []).forEach(function (e) {
      var right = (e.right || '').trim();
      if (!right) return;
      String(e.wrongs || '').split(/[,，、\n]/).map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s !== right; })
        .forEach(function (w) { list.push({ wrong: w, right: right, note: e.note || '', user: true }); });
    });
    if (opts.useLoanwords !== false) {
      LOANWORDS.forEach(function (p) {
        p[1].split(',').forEach(function (w) { list.push({ wrong: w, right: p[0], user: false }); });
      });
    }
    list.sort(function (a, b) { return b.wrong.length - a.wrong.length; });
    return list;
  }
  function termCheck(text, out, opts) {
    var list = buildTerms(opts);
    if (!list.length) return;
    var byWrong = {};
    list.forEach(function (t) { if (!byWrong[t.wrong]) byWrong[t.wrong] = t; });
    var re = new RegExp(Object.keys(byWrong).sort(function (a, b) { return b.length - a.length; }).map(escapeRe).join('|'), 'g');
    var m;
    while ((m = re.exec(text))) {
      var t = byWrong[m[0]];
      if (t.user) {
        // 바른 표기 안에 틀린 표기가 들어 있는 경우(예: 바른 '김철수', 틀린 '철수')는 건너뜀
        var ctxStart = Math.max(0, m.index - t.right.length), ctx = text.slice(ctxStart, m.index + m[0].length + t.right.length);
        var pos = ctx.indexOf(t.right);
        if (pos !== -1) {
          var absR = ctxStart + pos;
          if (absR <= m.index && absR + t.right.length >= m.index + m[0].length) continue;
        }
        out.push(mk('term-user', 'term', 'error', "표기 사전: '" + t.right + "'",
          "내 표기 사전에서 '" + t.right + "'(으)로 쓰기로 정한 말이에요." + (t.note ? ' 메모: ' + t.note : ''),
          m.index, m.index + m[0].length, m[0], t.right));
      } else {
        out.push(mk('term-loan', 'term', 'error', "외래어 표기: '" + t.right + "'",
          "국립국어원 외래어 표기법에 따르면 '" + t.right + "'(으)로 써요. (설정에서 기본 외래어 점검을 끌 수 있어요)",
          m.index, m.index + m[0].length, m[0], t.right));
      }
    }
  }

  // ════════════════════════════════════════════
  // 실행
  // ════════════════════════════════════════════
  function runRegexRules(text, out, opts) {
    var disabled = opts.disabledRules || {};
    RULES.forEach(function (r) {
      if (disabled[r.id]) return;
      r.re.lastIndex = 0;
      var m, guard = 0;
      while ((m = r.re.exec(text)) && guard++ < 5000) {
        if (m[0] === '' && !r.pick) { r.re.lastIndex++; continue; }
        var hit;
        if (r.pick) hit = r.pick(m, text);
        else hit = { start: m.index, end: m.index + m[0].length, suggestion: r.fix ? r.fix(m) : null };
        if (m[0] === '') r.re.lastIndex++;
        if (!hit) continue;
        out.push(mk(r.id, r.cat, r.level, r.title, r.explain, hit.start, hit.end,
          text.slice(hit.start, hit.end), hit.suggestion === undefined ? null : hit.suggestion));
      }
    });
  }

  function check(text, opts) {
    opts = opts || {};
    var out = [];
    var cats = opts.categories || {};
    var disabled = opts.disabledRules || {};
    runRegexRules(text, out, opts);
    if (!disabled['pu-quote']) quotePairs(text, out);
    if (!disabled['pu-quote-style']) quoteStyle(text, out, opts);
    if (!disabled['pu-ellipsis']) ellipsisCheck(text, out, opts);
    if (!disabled['long-sentence']) longSentences(text, out, opts);
    if (!disabled['ending-repeat']) endingRepeat(text, out, opts);
    if (!disabled['word-repeat']) wordRepeat(text, out, opts);
    termCheck(text, out, opts);

    out = out.filter(function (x) { return cats[x.cat] !== false && !disabled[x.ruleId]; });

    // 같은 자리에 겹친 지적 정리: 수준이 높은(error > check > style) 것을 먼저 남김
    var rank = { error: 0, check: 1, style: 2 };
    out.sort(function (a, b) { return rank[a.level] - rank[b.level] || a.start - b.start; });
    var result = [];
    out.forEach(function (x) {
      var dup = result.some(function (y) {
        if (y.level === 'style' || x.level === 'style') return y.ruleId === x.ruleId && y.start === x.start;
        // 고칠 말이 있는 지적끼리 범위가 겹치면 하나만 남김 (동시에 적용하면 엉킴)
        if (x.start < y.end && y.start < x.end) return true;
        if (x.start === x.end && x.start >= y.start && x.start <= y.end) return true;
        if (y.start === y.end && y.start >= x.start && y.start <= x.end) return true;
        return false;
      });
      if (!dup) result.push(x);
    });
    result.sort(function (a, b) { return a.start - b.start || rank[a.level] - rank[b.level]; });
    result.forEach(function (x) {
      x.key = x.ruleId + '|' + x.original + '|' + text.slice(Math.max(0, x.start - 8), x.start) + '|' + text.slice(x.end, x.end + 8);
    });
    return result;
  }

  // 원고 전체에서 가장 많이 쓴 말줄임표·따옴표 모양 찾기 (통일 기준)
  function dominantStyles(texts) {
    var el = {}, curly = 0, straight = 0;
    texts.forEach(function (t) {
      (t.match(/…+|\.{3,}/g) || []).forEach(function (tok) {
        var k = ellipsisKind(tok); if (k !== 'other') el[k] = (el[k] || 0) + 1;
      });
      curly += (t.match(/[“”]/g) || []).length;
      straight += (t.match(/"/g) || []).length;
    });
    var best = null, bestN = 0;
    Object.keys(el).forEach(function (k) { if (el[k] > bestN) { best = k; bestN = el[k]; } });
    var mixedEllipsis = Object.keys(el).length > 1;
    return {
      ellipsis: mixedEllipsis ? best : null,
      quote: curly && straight ? (curly >= straight ? 'curly' : 'straight') : null,
      ellipsisCounts: el
    };
  }

  // 사용자에게 보여 줄 규칙 목록 (설정 화면용)
  function ruleCatalog() {
    var seen = {}, list = [];
    RULES.forEach(function (r) {
      if (seen[r.id]) return; seen[r.id] = 1;
      list.push({ id: r.id, cat: r.cat, level: r.level, title: r.title });
    });
    [['pu-quote', 'punct', 'check', '따옴표 짝'], ['pu-quote-style', 'punct', 'error', '따옴표 모양 통일'],
      ['pu-ellipsis', 'punct', 'error', '말줄임표 통일'], ['long-sentence', 'style', 'style', '긴 문장'],
      ['ending-repeat', 'style', 'style', '같은 끝맺음 반복'], ['word-repeat', 'style', 'style', '같은 낱말 반복']]
      .forEach(function (x) { list.push({ id: x[0], cat: x[1], level: x[2], title: x[3] }); });
    return list;
  }

  var api = {
    check: check, sentences: sentences, dominantStyles: dominantStyles, ruleCatalog: ruleCatalog,
    CATS: CATS, LEVELS: LEVELS, LOANWORDS: LOANWORDS, _hasBatchim: hasBatchim
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rules = api;
})(this);
