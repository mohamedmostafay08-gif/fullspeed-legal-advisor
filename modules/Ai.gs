/**
 * السؤال والجواب: حماية البيانات الشخصية + Gemini (الخطة المجانية) + الرجوع التلقائي لوضع البحث.
 *
 * تنبيه مهم: الخطة المجانية من Google قد تستخدم ما يُرسل إليها لتحسين منتجاتها،
 * لذلك يُحذف من السؤال أي رقم قومي أو هاتف أو بريد أو رقم حساب قبل الإرسال،
 * وتطلب الواجهة من المستخدم إزالة الأسماء قبل الإرسال.
 */

var AI_INSTRUCTIONS = [
  'أنت المستشار القانوني والإداري الداخلي لشركة مصرية (قطاع اللوجستيات والتوصيل)، وتجيب موظفي الموارد البشرية والشؤون القانونية والمالية.',
  '',
  'مصادرك الوحيدة هي النصوص الموجودة داخل <legal_sources> في رسالة المستخدم. هي مواد مختارة آلياً كأقرب المواد للسؤال وليست القانون كاملاً:',
  '{{SOURCES}}',
  '',
  'قواعد صارمة:',
  '1. لا تذكر أي رقم مادة أو نص أو نسبة أو مبلغ أو مدة إلا إذا كان موجوداً حرفياً في المصادر المرفقة. ممنوع الاعتماد على الذاكرة.',
  '2. كل اقتباس في legal_texts منسوخ حرفياً من نص المادة (يجوز حذف أجزاء غير لازمة ووضع ... مكانها، لكن لا تعِد الصياغة). استخدم source و article كما في وسوم <article> بالضبط.',
  '3. النصوص مستخرجة آلياً من ملفات PDF وقد تحتوي أخطاء طباعة. اقتبس كما هو، واكتب الصحيح في التفسير.',
  '4. إذا لم تجد في المواد المرفقة ما يجيب على السؤال: found = false، وقل ذلك صراحة، ولا تخمّن، واذكر المرجع الناقص إن أمكن.',
  '5. إذا كانت الحالة تحتاج معلومات ناقصة لتحديد الحكم (هل المخالفة أول مرة؟ هل تم التحقيق؟ متى اكتُشفت؟)، اكتبها في clarifying_questions، وأجب على الاحتمالات الرئيسية في الأمثلة.',
  '6. القانون ملزم، واللائحة النموذجية استرشادية لحين اعتماد لائحة الشركة. إذا تعارضا فالقانون هو الأعلى.',
  '7. confidence: "explicit" إذا كان الحكم منصوصاً عليه صراحة، "inferred" إذا كان استنتاجاً، "needs_lawyer" إذا كانت الحالة نزاعاً أو فيها خطر قضائي أو تحتاج مرجعاً غير متاح.',
  '8. examples: من 2 إلى 3 أمثلة عملية مختلفة من بيئة شركة توصيل ولوجستيات (إداريون، مخازن، خدمة عملاء، مشرفون، محاسبون)، كل مثال بنتيجة مختلفة.',
  '9. cross_law: اربط بالقوانين الأخرى المتاحة فقط إذا وُجد نص فعلي مرتبط في المواد المرفقة، وإلا اتركها فارغة.',
  '10. اكتب بالعربية الفصحى المبسطة. explanation بنقاط قصيرة تبدأ بشرطة (-)، بدون عناوين.',
  '11. لا تكرر السؤال، ولا تضف مقدمات أو خاتمات. أعد JSON فقط.'
].join('\n');

// وصف إضافي ثابت للمصادر الأساسية (المصادر الجديدة التي يضيفها المدير تُوصف من جدول Sources)
var SOURCE_HINTS = {
  workreg: 'نموذج استرشادي وليست لائحة الشركة المعتمدة.',
  penreg: 'كل "مادة" فيها هي رقم مخالفة في جدول الجزاءات.',
  ins148: 'كما صدر، بدون تعديلات لاحقة.',
  tax151: 'المواد المعدلة فقط.'
};

function sourceEnum_() { return kbData_().order.slice(); }

/** تعليمات النموذج مع قائمة المراجع الحالية (تشمل أي مرجع أضافه مدير النظام). */
function aiInstructions_() {
  var d = kbData_();
  var list = d.order.map(function (id) {
    var s = d.sources[id];
    return '- ' + id + ': ' + s.title + (SOURCE_HINTS[id] ? ' (' + SOURCE_HINTS[id] + ')' : '');
  }).join('\n');
  return AI_INSTRUCTIONS.replace('{{SOURCES}}', list);
}

/** مخطط الإجابة بصيغة Gemini (OpenAPI مبسط). */
function answerSchema_() {
  var S = function (desc) { return desc ? { type: 'STRING', description: desc } : { type: 'STRING' }; };
  var src = { type: 'STRING', enum: sourceEnum_() };
  return {
    type: 'OBJECT',
    properties: {
      found: { type: 'BOOLEAN' },
      confidence: { type: 'STRING', enum: ['explicit', 'inferred', 'needs_lawyer'] },
      summary: S('الخلاصة في جملتين أو ثلاث'),
      legal_texts: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        source: src, article: S('رقم المادة كما في وسم article'), quote: S('اقتباس حرفي من نص المادة'), relevance: S('سبب أهمية المادة')
      }, required: ['source', 'article', 'quote', 'relevance'] } },
      explanation: S('التفسير المبسط والتطبيقي'),
      cross_law: { type: 'ARRAY', items: { type: 'OBJECT', properties: { source: src, article: S(), note: S() }, required: ['source', 'article', 'note'] } },
      examples: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: S(), scenario: S(), outcome: S() }, required: ['title', 'scenario', 'outcome'] } },
      clarifying_questions: { type: 'ARRAY', items: S() },
      missing_references: { type: 'ARRAY', items: S() }
    },
    required: ['found', 'confidence', 'summary', 'legal_texts', 'explanation', 'cross_law', 'examples', 'clarifying_questions', 'missing_references']
  };
}

// ---------------- حماية البيانات الشخصية ----------------

var PII_RULES = [
  // [النوع، النمط، البديل، هل للنمط مجموعة سابقة (pre) يجب الإبقاء عليها]
  ['national_id', /(^|[^\d])([23]\d{13})(?!\d)/g, '[رقم قومي محذوف]', true],
  ['iban', /EG\d{27}/gi, '[حساب بنكي محذوف]', false],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[بريد محذوف]', false],
  ['phone', /(^|[^\d])((?:\+?20|0020)?\s?0?1[0125][\s-]?\d{3,4}[\s-]?\d{4})(?!\d)/g, '[هاتف محذوف]', true],
  ['landline', /(^|[^\d])(0\d{1,2}[\s-]?\d{7,8})(?!\d)/g, '[هاتف محذوف]', true],
  ['long_number', /(^|[^\d])(\d{10,})(?!\d)/g, '[رقم محذوف]', true]
];

/** يحذف الأرقام والبيانات الحساسة من النص قبل إرساله لأي خدمة خارجية. */
function redactPii_(text) {
  var t = arDigits_(String(text)), found = [];
  PII_RULES.forEach(function (r) {
    t = t.replace(r[1], function (m, pre) {
      found.push(r[0]);
      return r[3] ? pre + r[2] : r[2];
    });
  });
  return { text: t, found: found };
}

// ---------------- Gemini ----------------

function aiModel_() { return getSetting_('gemini_model', 'gemini-3.5-flash-lite'); }

// المفتاحان: المجاني (مشروع بدون فوترة) والمدفوع (مشروع عليه فوترة أو رصيد)
var AI_TIERS = { free: ['GEMINI_API_KEY', 'المجاني'], paid: ['GEMINI_API_KEY_PAID', 'المدفوع'] };
var AI_MODES = {
  free_first: ['free', 'paid'],  // المجاني أولاً، وعند انتهاء حصته أو تعطله يُستخدم المدفوع
  free_only: ['free'],
  paid_only: ['paid']
};

function aiMode_() { var m = getSetting_('ai_mode', 'free_first'); return AI_MODES[m] ? m : 'free_first'; }

/** المفاتيح المتاحة بترتيب الاستخدام حسب الطريقة المختارة. */
function aiKeys_() {
  var props = PropertiesService.getScriptProperties();
  return AI_MODES[aiMode_()].map(function (tier) {
    return { tier: tier, key: props.getProperty(AI_TIERS[tier][0]) };
  }).filter(function (k) { return !!k.key; });
}

function aiKey_() { var k = aiKeys_(); return k.length ? k[0].key : null; }

function aiUsageInc_(tier) {
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); // الحصة اليومية تبدأ منتصف الليل بتوقيت المحيط الهادئ
  var u = getSetting_('ai_usage', {}) || {};
  if (u.date !== today) u = { date: today, count: 0, free: 0, paid: 0 };
  u.count = (u.count || 0) + 1;
  u[tier] = (u[tier] || 0) + 1;
  setSetting_('ai_usage', u);
}

/** طلب واحد لـ Gemini بمفتاح محدد. parts: نص أو قائمة أجزاء (نص/صورة/PDF). */
function geminiRequest_(key, system, parts, schema) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(aiModel_()) + ':generateContent';
  var gen = { temperature: 0.15, responseMimeType: 'application/json' };
  if (schema) gen.responseSchema = schema;
  if (typeof parts === 'string') parts = [{ text: parts }];
  var payload = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: parts }], generationConfig: gen };
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
                                     payload: JSON.stringify(payload), muteHttpExceptions: true });
  var code = res.getResponseCode(), body = res.getContentText();
  if (code !== 200) {
    var err = new Error('Gemini ' + code + ': ' + body.slice(0, 300));
    err.kind = code === 429 ? 'quota' : (code === 400 ? 'bad_request' : (code === 403 || code === 401 ? 'auth' : 'server'));
    throw err;
  }
  var data = JSON.parse(body);
  var cand = (data.candidates || [])[0];
  if (!cand || !cand.content) { var e2 = new Error('empty: ' + (cand && cand.finishReason)); e2.kind = 'blocked'; throw e2; }
  var text = cand.content.parts.filter(function (p) { return !p.thought && p.text; }).map(function (p) { return p.text; }).join('');
  return { text: text, usage: data.usageMetadata || {} };
}

/** يجرب المفاتيح بالترتيب: إذا انتهت حصة المجاني أو تعطل، ينتقل للمدفوع تلقائياً. */
function geminiCall_(system, parts, schema) {
  var keys = aiKeys_();
  if (!keys.length) { var e = new Error('no key'); e.kind = 'nokey'; throw e; }
  var last;
  for (var i = 0; i < keys.length; i++) {
    try {
      var out = geminiRequest_(keys[i].key, system, parts, schema);
      aiUsageInc_(keys[i].tier);
      out.tier = keys[i].tier;
      return out;
    } catch (err) {
      last = err;
      if (err.kind === 'bad_request' || err.kind === 'blocked') throw err; // نفس الطلب سيفشل بالمفتاح الآخر
      console.warn('Gemini ' + keys[i].tier + ' failed: ' + err.message);
    }
  }
  throw last;
}

function parseJsonLoose_(text) {
  try { return JSON.parse(text); } catch (e) {
    var m = String(text).match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw e;
  }
}

function geminiAnswer_(question, mode, history) {
  var items = kbRetrieve_(question);
  var ctx = items.map(function (a) {
    var src = kbData_().sources[a.source];
    var note = a.also && a.also.length ? ' note="' + a.label + '"' : '';
    return '<article source="' + a.source + '" num="' + a.num + '" law="' + src.short + '"' + note + '>\n' + a.text + '\n</article>';
  }).join('\n');
  var prev = '';
  if (history && history.length) {
    prev = '<previous_turns>\n' + history.slice(-3).map(function (h) {
      return '- سؤال سابق: ' + redactPii_(h.question).text + '\n  الخلاصة: ' + h.summary;
    }).join('\n') + '\n</previous_turns>\n\n';
  }
  var tag = mode === 'case' ? 'case' : 'question';
  var userText = '<legal_sources>\n' + ctx + '\n</legal_sources>\n\n' + prev + '<' + tag + '>\n' + question + '\n</' + tag + '>\n\nأجب وفق القواعد بصيغة JSON.';
  var out;
  try {
    out = geminiCall_(aiInstructions_(), userText, answerSchema_());
  } catch (e) {
    if (e.kind !== 'bad_request') throw e;
    out = geminiCall_(aiInstructions_(), userText, null); // إعادة المحاولة بدون المخطط إذا رفضه النموذج
  }
  var answer = parseJsonLoose_(out.text);
  var schema = answerSchema_();
  schema.required.forEach(function (k) {
    if (answer[k] === undefined) answer[k] = schema.properties[k].type === 'ARRAY' ? [] : (k === 'found' ? false : '');
  });
  return { answer: answer, tier: out.tier, context: items.map(function (a) { return { source: a.source, article: a.num }; }),
           usage: { input_tokens: out.usage.promptTokenCount || 0, output_tokens: out.usage.candidatesTokenCount || 0 } };
}

function searchOnlyAnswer_(question) {
  var results = kbSearch_(question, 6);
  var texts = results.map(function (r) {
    var a = getArticle_(r.source, r.num);
    return { source: r.source, article: r.num, quote: a.text.slice(0, 450) + (a.text.length > 450 ? '…' : ''),
             relevance: r.chapter || 'من أقرب المواد لكلمات سؤالك' };
  });
  return {
    found: texts.length > 0, confidence: 'needs_lawyer',
    summary: 'هذه أقرب المواد لكلمات سؤالك. وضع البحث يعرض النصوص فقط بدون تحليل أو تفسير.',
    legal_texts: texts,
    explanation: '- اقرأ نص المواد المعروضة، واضغط على أي مادة لعرضها كاملة.\n- للحصول على تفسير وأمثلة، يجب أن يكون مفتاح Gemini مُعدّاً ولم تنته الحصة اليومية.',
    cross_law: [], examples: [], clarifying_questions: [], missing_references: []
  };
}

var AI_FAIL_MSG = {
  nokey: 'لم يتم إعداد مفتاح Gemini بعد (من صفحة الإدارة)، فتم عرض أقرب المواد فقط.',
  quota: 'انتهت حصة Gemini مؤقتاً (عدد الأسئلة في الدقيقة أو اليوم) على كل المفاتيح المتاحة، فتم عرض أقرب المواد فقط. حاول بعد قليل.',
  auth: 'مفتاح Gemini غير صالح أو غير مفعّل، فتم عرض أقرب المواد فقط. راجع المفتاح من صفحة الإدارة.',
  blocked: 'لم يُرجع Gemini إجابة لهذا السؤال، فتم عرض أقرب المواد فقط. جرّب إعادة الصياغة.',
  server: 'خدمة Gemini غير متاحة الآن، فتم عرض أقرب المواد فقط.',
  bad_request: 'تعذر على Gemini معالجة الطلب، فتم عرض أقرب المواد فقط.',
  parse: 'وصلت إجابة غير مكتملة من Gemini، فتم عرض أقرب المواد فقط. أعد المحاولة.'
};

// ---------------- الإجراءات ----------------

function askQuestion_(d, user) {
  var raw = String(d.question || '').trim();
  if (raw.length < 5) throw userError_('اكتب السؤال أو الحالة بتفصيل أكثر');
  if (raw.length > 4000) throw userError_('السؤال طويل جداً؛ اختصره (الحد 4000 حرف)');
  var red = redactPii_(raw);           // حذف تلقائي للأرقام والبيانات الحساسة (احتياط إضافي بعد تنبيه الواجهة)
  var q = red.text, mode = d.mode === 'case' ? 'case' : 'question';
  var result = { provider: 'gemini', model: aiModel_(), notice: null, redactions: red.found };
  try {
    var g = geminiAnswer_(q, mode, d.history || []);
    result.answer = g.answer; result.context = g.context; result.usage = g.usage; result.tier = g.tier;
    result.model = aiModel_() + (g.tier === 'paid' ? ' (المفتاح المدفوع)' : ' (المفتاح المجاني)');
  } catch (e) {
    console.warn(e);
    var kind = e.kind || (e instanceof SyntaxError ? 'parse' : 'server');
    result.provider = 'search'; result.model = 'بحث فقط';
    result.answer = searchOnlyAnswer_(q);
    result.notice = AI_FAIL_MSG[kind] || AI_FAIL_MSG.server;
  }
  result.verification = verifyAnswer_(result.answer);
  result.question = q;
  result.id = String(Date.now());
  appendRow_('Questions', { id: result.id, time: new Date(), username: user.username, mode: mode, question: q,
    provider: result.provider, model: result.model, answer_json: JSON.stringify(result.answer).slice(0, 49000),
    verification_json: JSON.stringify(result.verification).slice(0, 49000), redactions: red.found.join(',') });
  result.sources = sourceShorts_();
  return result;
}

function saveFeedback_(d, user) {
  var rows = readRows_('Questions');
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].id) === String(d.id) && (rows[i].username === user.username || user.role === 'admin')) {
      updateRow_('Questions', rows[i]._row, { feedback: d.rating === 'good' ? 'good' : 'bad', feedback_note: String(d.note || '').slice(0, 1000) });
      return { done: true };
    }
  }
  throw userError_('السؤال غير موجود');
}

function listHistory_(d, user) {
  return readRows_('Questions').filter(function (r) { return user.role === 'admin' || r.username === user.username; })
    .slice(-200).reverse().map(function (r) {
      return { id: String(r.id), time: Utilities.formatDate(new Date(r.time), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
               username: r.username, question: String(r.question).slice(0, 160), feedback: r.feedback, provider: r.provider };
    });
}

function getHistoryItem_(d, user) {
  var rows = readRows_('Questions');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.id) === String(d.id) && (user.role === 'admin' || r.username === user.username)) {
      return { id: String(r.id), question: r.question, provider: r.provider, model: r.model, answer: JSON.parse(r.answer_json),
               verification: JSON.parse(r.verification_json), feedback: r.feedback, sources: sourceShorts_(),
               redactions: r.redactions ? String(r.redactions).split(',') : [] };
    }
  }
  throw userError_('غير موجود');
}

// ---------------- الإدارة ----------------

function adminOverview_() {
  var users = readRows_('Users').map(publicUser_);
  var qs = readRows_('Questions');
  var month = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM');
  var stats = { total: qs.length, month: 0, good: 0, bad: 0, ai: 0, search: 0 };
  var perUser = {};
  qs.forEach(function (r) {
    if (Utilities.formatDate(new Date(r.time), 'Africa/Cairo', 'yyyy-MM') === month) stats.month++;
    if (r.feedback === 'good') stats.good++;
    if (r.feedback === 'bad') stats.bad++;
    if (r.provider === 'gemini') stats.ai++; else stats.search++;
    perUser[r.username] = (perUser[r.username] || 0) + 1;
  });
  users.forEach(function (u) { u.questions = perUser[u.username] || 0; });
  var usage = getSetting_('ai_usage', {}) || {};
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  return {
    users: users, maxUsers: MAX_USERS, stats: stats,
    ai: { hasKey: !!aiKey_(), hasFree: !!PropertiesService.getScriptProperties().getProperty(AI_TIERS.free[0]),
          hasPaid: !!PropertiesService.getScriptProperties().getProperty(AI_TIERS.paid[0]), mode: aiMode_(), model: aiModel_(),
          usedToday: usage.date === today ? (usage.count || 0) : 0, usedFree: usage.date === today ? (usage.free || 0) : 0,
          usedPaid: usage.date === today ? (usage.paid || 0) : 0 },
    settings: { company_name: getSetting_('company_name', 'Full Speed'), insurance_limits: getSetting_('insurance_limits', {}) || {},
                payroll_tax: getSetting_('payroll_tax', {}) || {} },
    missingViolations: missingViolations_(),
    sheetUrl: ss_().getUrl()
  };
}

function adminSaveSettings_(d) {
  if (d.company_name !== undefined) {
    var name = String(d.company_name).trim();
    if (name.length < 2 || name.length > 60) throw userError_('اسم الشركة غير صحيح');
    setSetting_('company_name', name);
  }
  if (d.ai_mode !== undefined) {
    if (!AI_MODES[d.ai_mode]) throw userError_('طريقة استخدام المفاتيح غير صحيحة');
    setSetting_('ai_mode', d.ai_mode);
  }
  if (d.gemini_model !== undefined) {
    if (!/^[a-z0-9.\-]{3,60}$/.test(d.gemini_model)) throw userError_('اسم النموذج غير صحيح');
    setSetting_('gemini_model', d.gemini_model);
  }
  if (d.insurance_year !== undefined) {
    var y = parseInt(d.insurance_year, 10), mn = parseFloat(d.insurance_min), mx = parseFloat(d.insurance_max);
    if (!(y > 2000 && mn > 0 && mx > mn)) throw userError_('أدخل السنة والحدين بشكل صحيح (الأقصى أكبر من الأدنى)');
    var lim = getSetting_('insurance_limits', {}) || {};
    lim[String(y)] = { min: mn, max: mx };
    setSetting_('insurance_limits', lim);
  }
  if (d.tax_brackets !== undefined) {
    var rows = [];
    String(d.tax_brackets).split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var parts = line.replace('،', ',').split(',');
      if (parts.length !== 2) throw userError_('صيغة الشرائح: كل سطر "الحد الأعلى، النسبة" والشريحة الأخيرة "-، النسبة"');
      var up = parts[0].trim(), rate = parseFloat(parts[1]);
      if (isNaN(rate)) throw userError_('نسبة غير صحيحة في: ' + line);
      rows.push({ up_to: (up === '-' || up === '' || up === '∞') ? null : parseFloat(up), rate: rate });
    });
    if (!String(d.tax_source || '').trim()) throw userError_('اكتب مصدر الشرائح (رقم القانون وتاريخه)');
    setSetting_('payroll_tax', { brackets: rows, personal_exemption: parseFloat(d.tax_exemption || 0) || 0, source: String(d.tax_source).trim() });
  }
  return { done: true };
}

function adminSaveApiKey_(d) {
  var tier = AI_TIERS[d.tier] ? d.tier : 'free';
  var key = String(d.key || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (d.remove) { props.deleteProperty(AI_TIERS[tier][0]); return { done: true, removed: true }; }
  if (!/^[A-Za-z0-9_.\-]{20,200}$/.test(key)) throw userError_('شكل المفتاح غير صحيح');
  props.setProperty(AI_TIERS[tier][0], key);
  return { done: true };
}

/** يختبر كل مفتاح موجود على حدة. */
function adminTestAi_() {
  var props = PropertiesService.getScriptProperties(), results = [];
  Object.keys(AI_TIERS).forEach(function (tier) {
    var key = props.getProperty(AI_TIERS[tier][0]);
    if (!key) return;
    try {
      geminiRequest_(key, 'أجب بصيغة JSON فقط.', 'أعد {"ok": true}', null);
      results.push({ tier: tier, label: AI_TIERS[tier][1], ok: true });
    } catch (e) {
      results.push({ tier: tier, label: AI_TIERS[tier][1], ok: false, error: AI_FAIL_MSG[e.kind] || String(e.message).slice(0, 200), detail: String(e.message).slice(0, 300) });
    }
  });
  if (!results.length) return { ok: false, model: aiModel_(), results: [], error: AI_FAIL_MSG.nokey };
  return { ok: results.every(function (r) { return r.ok; }), model: aiModel_(), results: results };
}

// ---------------- استخراج نص قانون من صورة أو PDF ----------------

var EXTRACT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
var EXTRACT_SYSTEM = [
  'أنت أداة نسخ نصوص قانونية عربية من صور وملفات PDF ممسوحة ضوئياً.',
  'انسخ النص حرفياً كما هو بدون أي تعديل أو تلخيص أو تصحيح للمعنى، مع الحفاظ على الأرقام والنسب كما هي.',
  'قسّم النص إلى مواد: كل مادة تبدأ بعنوان مثل "مادة (5)" أو "المادة الخامسة". ضع رقم المادة في num بالأرقام إن أمكن (أو الكلمة كما هي)، والعنوان كما هو في label، والنص كاملاً في text بدون العنوان.',
  'إذا كان الجزء من جدول (مثل جدول مخالفات وجزاءات)، اجعل كل صف مادة مستقلة: num رقم الصف، و text وصف الصف وكل خاناته بالترتيب.',
  'ضع عنوان الباب أو الفصل في chapter إن وُجد. إذا لم توجد عناوين مواد، أعد مادة واحدة بالنص كله.',
  'إذا كان جزء غير مقروء، اكتب [غير مقروء] مكانه ولا تخمّن.'
].join('\n');

function extractSchema_() {
  return { type: 'OBJECT', properties: { articles: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    num: { type: 'STRING' }, label: { type: 'STRING' }, chapter: { type: 'STRING' }, text: { type: 'STRING' }
  }, required: ['num', 'label', 'text'] } } }, required: ['articles'] };
}

/** يستخرج المواد من ملف (صورة أو PDF) مرفوع على أجزاء، ويعيدها للمراجعة قبل الحفظ. */
function adminExtract_(d, admin) {
  var mime = String(d.mime || '').toLowerCase();
  if (EXTRACT_MIMES.indexOf(mime) < 0) throw userError_('نوع الملف غير مدعوم. استخدم صورة (JPG أو PNG) أو PDF');
  var b64 = assembleRaw_('ext_' + admin.username + '_', parseInt(d.total, 10));
  if (!/^[A-Za-z0-9+\/=]+$/.test(b64)) throw userError_('تعذرت قراءة الملف المرفوع');
  var out = geminiCall_(EXTRACT_SYSTEM, [{ inlineData: { mimeType: mime, data: b64 } },
    { text: 'استخرج نص هذا المستند وقسّمه إلى مواد بصيغة JSON.' }], extractSchema_());
  var res = parseJsonLoose_(out.text);
  var arts = (res.articles || []).map(cleanArticleInput_).filter(function (a) { return a.text; });
  if (!arts.length) throw userError_('لم يُستخرج أي نص من الملف. جرّب صورة أوضح.');
  return { articles: arts, tier: out.tier };
}

/** يقسم نصاً ملصوقاً إلى مواد حسب عناوين "مادة (5)" أو "المادة الخامسة". */
function adminSplitText_(d) {
  return { articles: splitArticlesText_(String(d.text || '')) };
}

// ---------------- تحديث البيانات عند تعديل الجداول يدوياً ----------------

function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (['Articles', 'Sources', 'Penalties'].indexOf(name) >= 0) clearKbCache_();
  if (name === 'Settings') CacheService.getScriptCache().removeAll(readRows_('Settings').map(function (r) { return 'set_' + r.key; }));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('المستشار القانوني')
    .addItem('تحديث البيانات في البرنامج', 'refreshData')
    .addItem('إنشاء كود الإعداد الأول', 'createSetupCode')
    .addToUi();
}

function refreshData() {
  clearKbCache_();
  CacheService.getScriptCache().removeAll(readRows_('Settings').map(function (r) { return 'set_' + r.key; }));
  SpreadsheetApp.getActive().toast('تم تحديث البيانات في البرنامج');
}
