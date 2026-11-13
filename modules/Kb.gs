/**
 * قاعدة المعرفة القانونية: تحميل المواد، البحث العربي، اختيار المواد للنموذج، والتحقق من الاقتباسات.
 * (نفس منطق النسخة الأولى: توحيد الكتابة + قاموس العامية + تجذيع خفيف + BM25 بأوزان)
 */

var SOURCE_ORDER = ['labor14', 'workreg', 'penreg', 'ins148', 'tax151'];

// ---------------- التحميل ----------------

function kbData_() {
  if (kbData_.memo) return kbData_.memo;
  var data = cacheGetBig_('kb_v1');
  if (!data) {
    var sources = {};
    readRows_('Sources').forEach(function (s) {
      sources[s.id] = { id: s.id, title: s.title, short: s.short, citation: s.citation, pdf: s.pdf, notes: s.notes };
    });
    var articles = [];
    readRows_('Articles').forEach(function (a) {
      articles.push({ source: String(a.source), num: String(a.num), label: String(a.label), chapter: String(a.chapter || ''),
                      page: a.page === '' ? null : Number(a.page),
                      also: a.also_contains ? String(a.also_contains).split(',') : [], text: String(a.text) });
    });
    penaltyArticles_().forEach(function (a) { articles.push(a); });
    data = { sources: sources, articles: articles };
    cachePutBig_('kb_v1', data);
  }
  var map = {};
  data.articles.forEach(function (a) { map[a.source + '|' + a.num] = a; });
  data.articles.forEach(function (a) {
    (a.also || []).forEach(function (n) { if (!map[a.source + '|' + n]) map[a.source + '|' + n] = a; });
  });
  data.map = map;
  // ترتيب المراجع: الأساسية أولاً ثم ما أضافه المدير بترتيب جدول Sources
  data.order = SOURCE_ORDER.filter(function (k) { return data.sources[k]; })
    .concat(Object.keys(data.sources).filter(function (k) { return SOURCE_ORDER.indexOf(k) < 0; }));
  kbData_.memo = data;
  return data;
}

function kbReset_() {
  clearKbCache_();
  kbData_.memo = null;
  kbIndex_.memo = null;
}

/** يمسح النصوص والفهرس المخزنين مؤقتاً (عند تعديل الجداول). */
function clearKbCache_() {
  cacheClearBig_('kb_v1');
  cacheClearBig_('kbidx_v1');
}

function normNum_(num) {
  num = arDigits_(String(num)).trim();
  num = num.replace(/^(?:المادة|مادة|مخالفة|المخالفة|م\.?)\s+/, '');
  return num.replace(/^[\s()]+|[\s()]+$/g, '');
}

function getArticle_(source, num) {
  return kbData_().map[source + '|' + normNum_(num)] || null;
}

// ---------------- التوحيد والتقطيع ----------------

function arDigits_(s) {
  return s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
          .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
}

function normalizeAr_(text) {
  return arDigits_(String(text))
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}

function words_(text) {
  return normalizeAr_(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}

function lightStem_(w) {
  var P = KB_DICT.PREFIXES, S = KB_DICT.SUFFIXES;
  for (var i = 0; i < P.length; i++) {
    if (w.indexOf(P[i]) === 0 && w.length - P[i].length >= 3) { w = w.slice(P[i].length); break; }
  }
  for (var j = 0; j < S.length; j++) {
    var s = S[j];
    if (w.length - s.length >= 3 && w.slice(-s.length) === s) { w = w.slice(0, -s.length); break; }
  }
  return w;
}

function tokenize_(text) {
  var out = [];
  words_(text).forEach(function (w) {
    if (w.length < 2) return;
    var stem = lightStem_(w);
    var mapped = KB_DICT.SYNONYMS[w] || KB_DICT.SYNONYMS[stem];
    var forms = {};
    forms[w] = 1; forms[stem] = 1;
    if (mapped) { forms[mapped] = 1; forms[lightStem_(mapped)] = 1; }
    Object.keys(forms).forEach(function (f) { if (f.length > 1) out.push(f); });
  });
  return out;
}

var STOP_SET_ = null;
function queryTerms_(text) {
  if (!STOP_SET_) { STOP_SET_ = {}; KB_DICT.STOPWORDS.forEach(function (s) { STOP_SET_[s] = 1; }); }
  var terms = {};
  words_(text).forEach(function (w) {
    if (w.length < 2 || STOP_SET_[w]) return;
    var stem = lightStem_(w);
    var mapped = KB_DICT.SYNONYMS[w] || KB_DICT.SYNONYMS[stem];
    [w, stem].forEach(function (f) { if (f.length > 1 && !STOP_SET_[f]) terms[f] = Math.max(terms[f] || 0, 1); });
    if (mapped) [mapped, lightStem_(mapped)].forEach(function (f) { terms[f] = Math.max(terms[f] || 0, 2); });
  });
  return terms;
}

// ---------------- البحث (BM25) ----------------

function kbIndex_() {
  if (kbIndex_.memo) return kbIndex_.memo;
  var arts = kbData_().articles;
  var cached = cacheGetBig_('kbidx_v1');
  if (cached && cached.tfs.length === arts.length) {
    kbIndex_.memo = { df: cached.df, avg: cached.avg, docs: arts.map(function (a, i) { return { a: a, tf: cached.tfs[i], len: cached.lens[i] }; }) };
    return kbIndex_.memo;
  }
  var docs = [], df = {}, total = 0;
  kbData_().articles.forEach(function (a) {
    var body = a.text;
    if (a.source === 'penreg') {
      body = body.replace(/الحد الأقصى للجزاء - [^\n]*/g, ' ').replace(/المخالفة رقم \d+ \([^)]*\):/g, ' ');
    }
    var tf = {}, toks = tokenize_(a.chapter + ' ' + body);
    toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
    Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    docs.push({ a: a, tf: tf, len: toks.length });
    total += toks.length;
  });
  kbIndex_.memo = { docs: docs, df: df, avg: total / Math.max(docs.length, 1) };
  cachePutBig_('kbidx_v1', { df: df, avg: kbIndex_.memo.avg, tfs: docs.map(function (d) { return d.tf; }), lens: docs.map(function (d) { return d.len; }) });
  return kbIndex_.memo;
}

function kbSearch_(query, limit, source) {
  var idx = kbIndex_(), n = idx.docs.length;
  var terms = queryTerms_(query);
  var direct = (normalizeAr_(query).match(/(?:ماده|مادة|م)\s*\(?\s*(\d{1,3})/g) || [])
    .map(function (m) { return m.replace(/\D/g, ''); });
  var scored = [];
  idx.docs.forEach(function (d) {
    if (source && d.a.source !== source) return;
    var score = 0;
    Object.keys(terms).forEach(function (t) {
      var f = d.tf[t];
      if (!f) return;
      var idf = Math.log(1 + (n - idx.df[t] + 0.5) / (idx.df[t] + 0.5));
      score += terms[t] * idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * d.len / idx.avg));
    });
    if (direct.indexOf(d.a.num) >= 0) score += 50;
    if (score > 0) scored.push([score, d.a]);
  });
  scored.sort(function (x, y) { return y[0] - x[0]; });
  return scored.slice(0, limit || 15).map(function (s) {
    var a = s[1];
    return { source: a.source, num: a.num, label: a.label, chapter: a.chapter, page: a.page,
             snippet: a.text.slice(0, 260), score: Math.round(s[0] * 100) / 100 };
  });
}

/** يختار المواد التي تُرسل للنموذج: أقرب المواد بالبحث + مواد أساسية حسب الموضوع. */
function kbRetrieve_(question, maxChars) {
  maxChars = maxChars || 30000;
  var picked = [], seen = {};
  function add(src, num) {
    var a = getArticle_(src, num);
    if (a && !seen[a.source + '|' + a.num]) { seen[a.source + '|' + a.num] = 1; picked.push(a); }
  }
  kbSearch_(question, 15).forEach(function (r) { add(r.source, r.num); });
  var expanded = question + ' ' + Object.keys(queryTerms_(question)).join(' ');
  KB_DICT.TOPICS.forEach(function (t) {
    if (new RegExp(t[0]).test(expanded)) t[1].forEach(function (ref) { add(ref[0], ref[1]); });
  });
  ['penreg', 'labor14', 'ins148'].forEach(function (src) {
    kbSearch_(question, 2, src).forEach(function (r) { add(r.source, r.num); });
  });
  var out = [], total = 0;
  picked.forEach(function (a) {
    if (total + a.text.length > maxChars) return;
    total += a.text.length;
    out.push(a);
  });
  return out;
}

// ---------------- التحقق من الاقتباس ----------------

function cleanCmp_(t) {
  return normalizeAr_(t).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** نسبة كلمات الاقتباس الموجودة في نص المادة ضمن تتابعات من 3 كلمات فأكثر (1 = مطابق). */
function quoteMatch_(quote, articleText) {
  var t = cleanCmp_(articleText), tw = t.split(' ');
  var pos = {};
  tw.forEach(function (w, i) { (pos[w] = pos[w] || []).push(i); });
  var segments = String(quote).split(/\.{2,}|…/).filter(function (s) { return cleanCmp_(s); });
  var total = 0, matched = 0;
  segments.forEach(function (seg) {
    var q = cleanCmp_(seg), qw = q.split(' ');
    total += qw.length;
    if ((' ' + t + ' ').indexOf(' ' + q + ' ') >= 0) { matched += qw.length; return; }
    var minBlock = Math.min(3, qw.length), i = 0;
    while (i < qw.length) {
      var best = 0;
      (pos[qw[i]] || []).forEach(function (p) {
        var L = 0;
        while (i + L < qw.length && p + L < tw.length && qw[i + L] === tw[p + L]) L++;
        if (L > best) best = L;
      });
      if (best >= minBlock) { matched += best; i += best; } else { i++; }
    }
  });
  return total ? Math.round(matched / total * 1000) / 1000 : 0;
}

function verifyAnswer_(answer) {
  var checks = [];
  (answer.legal_texts || []).forEach(function (it) {
    var a = getArticle_(it.source, it.article);
    if (!a) { checks.push({ source: it.source, article: it.article, status: 'missing', score: 0 }); return; }
    var score = quoteMatch_(it.quote || '', a.text);
    checks.push({ source: it.source, article: it.article, score: score,
                  status: score >= 0.9 ? 'ok' : (score >= 0.6 ? 'partial' : 'mismatch') });
  });
  (answer.cross_law || []).forEach(function (it) {
    var ok = !!getArticle_(it.source, it.article);
    checks.push({ source: it.source, article: it.article, status: ok ? 'ok' : 'missing', score: ok ? 1 : 0, cross: true });
  });
  var problems = checks.filter(function (c) { return c.status === 'missing' || c.status === 'mismatch'; }).length;
  return { checks: checks, all_ok: problems === 0, problems: problems };
}

// ---------------- واجهات للقسم "القوانين" ----------------

function sourceShorts_() {
  var s = kbData_().sources, out = {};
  Object.keys(s).forEach(function (k) { out[k] = s[k].short; });
  return out;
}

function kbSources_() {
  var d = kbData_(), counts = {};
  d.articles.forEach(function (a) { counts[a.source] = (counts[a.source] || 0) + 1; });
  return d.order.map(function (k) {
    var s = d.sources[k];
    return { id: k, core: SOURCE_ORDER.indexOf(k) >= 0, title: s.title, short: s.short, citation: s.citation, notes: s.notes, count: counts[k] || 0, pdfUrl: pdfUrl_(k) };
  });
}

function kbSearchApi_(d) {
  return { results: kbSearch_(String(d.q || ''), 25, d.source || null), sources: sourceShorts_() };
}

function kbArticleApi_(d) {
  var a = getArticle_(d.source, d.num);
  if (!a) throw userError_('المادة غير موجودة في المراجع المتاحة');
  var s = kbData_().sources[a.source];
  return { source: a.source, num: a.num, label: a.label, chapter: a.chapter, page: a.page, text: a.text,
           also: a.also, requested: String(d.num), source_short: s.short, source_title: s.title, pdfUrl: pdfUrl_(a.source) };
}

function kbListApi_(d) {
  var s = kbData_().sources[d.source];
  if (!s) throw userError_('المرجع غير موجود');
  return { source: { id: d.source, title: s.title, short: s.short, notes: s.notes, pdfUrl: pdfUrl_(d.source) },
           articles: kbData_().articles.filter(function (a) { return a.source === d.source; })
             .map(function (a) { return { num: a.num, label: a.label, chapter: a.chapter, page: a.page, text: a.text }; }) };
}

/** رابط ملف PDF الأصلي في Google Drive (يُبحث عنه بالاسم داخل مجلد البرنامج مرة واحدة ثم يُحفظ). */
function pdfUrl_(source) {
  var s = kbData_().sources[source];
  if (!s || !s.pdf) return null;
  var key = 'pdf_' + source;
  var saved = getSetting_(key, null);
  if (saved) return saved;
  var cache = CacheService.getScriptCache();
  if (cache.get('pdfmiss_' + source)) return null; // لم يُرفع بعد؛ لا نبحث في Drive مع كل طلب
  try {
    var files = DriveApp.getFilesByName(s.pdf);
    if (files.hasNext()) {
      var url = files.next().getUrl();
      setSetting_(key, url);
      return url;
    }
  } catch (e) { console.warn(e); }
  cache.put('pdfmiss_' + source, '1', 3600);
  return null;
}
