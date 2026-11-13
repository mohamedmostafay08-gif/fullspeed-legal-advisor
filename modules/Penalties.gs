/**
 * لائحة الجزاءات ومساعد الجزاءات (قواعد ثابتة، بدون ذكاء اصطناعي).
 * الجدول في ورقة "Penalties": صف لكل مخالفة (أو لكل حالة فرعية)، والجزاءات مكتوبة بالعربي
 * من قائمة منسدلة، فيمكن لمدير النظام إدخال المخالفات الناقصة مباشرة في الجدول.
 *
 * المراجع من قانون العمل 14 لسنة 2025: المواد 138، 139، 140، 141، 142، 143، 144، 145، 148، 151، 153.
 */

var PEN_CODES = {
  W: 'إنذار كتابي', Q: 'خصم ربع يوم', H: 'خصم نصف يوم', '1': 'خصم يوم', '2': 'خصم يومين',
  '3': 'خصم ثلاثة أيام', '4': 'خصم أربعة أيام', '5': 'خصم خمسة أيام',
  R: 'الحرمان من نصف العلاوة', D: 'الخفض إلى الوظيفة الأدنى مباشرة',
  F: 'الإحالة إلى المحكمة العمالية للفصل من العمل',
  A: 'يعتبر غائباً (يُطبق جزاء الغياب)'
};
var PEN_DAYS = { W: 0, Q: 0.25, H: 0.5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
var PEN_SECTIONS = [
  'أولاً: مخالفات تتعلق بمواعيد العمل',
  'ثانياً: مخالفات تتعلق بنظام العمل والانضباط الوظيفي',
  'ثالثاً: (عنوان القسم في الصفحات الناقصة من الملف)',
  'رابعاً: مخالفات تتعلق بالتحول الرقمي وأمن المعلومات',
  'خامساً: مخالفات تتعلق بأحكام السلامة والصحة المهنية وتأمين بيئة العمل'
];
var ORDINALS = ['أول مرة', 'ثاني مرة', 'ثالث مرة', 'رابع مرة'];

function codeOf_(label) {
  label = String(label || '').trim();
  for (var k in PEN_CODES) if (PEN_CODES[k] === label) return k;
  return null;
}

/** المخالفات من ورقة Penalties، مجمّعة برقم المخالفة. */
function violations_() {
  if (violations_.memo) return violations_.memo;
  var byNum = {}, order = [];
  readRows_('Penalties').forEach(function (r) {
    var num = parseInt(r.num, 10);
    if (!num) return;
    var unc = String(r.uncertain || '').split(',').map(function (x) { return parseInt(x, 10); });
    var pens = ['first', 'second', 'third', 'fourth'].map(function (col, i) {
      var code = codeOf_(r[col]);
      return code ? { code: code, text: PEN_CODES[code], days: PEN_DAYS[code], uncertain: unc.indexOf(i + 1) >= 0 } : null;
    });
    if (pens.some(function (p) { return !p; })) return; // صف غير مكتمل
    if (!byNum[num]) {
      byNum[num] = { num: num, section: String(r.section), text: String(r.text), cases: [], page: r.page === '' ? null : Number(r.page),
                     manual: r.manual === true || r.manual === 'TRUE', entered_by: String(r.entered_by || ''),
                     entered_at: r.entered_at ? String(r.entered_at) : '' };
      order.push(num);
    }
    byNum[num].cases.push({ label: String(r.case_label || ''), penalties: pens });
  });
  order.sort(function (a, b) { return a - b; });
  violations_.memo = order.map(function (n) { return byNum[n]; });
  return violations_.memo;
}

function getViolation_(num) {
  num = parseInt(num, 10);
  var list = violations_();
  for (var i = 0; i < list.length; i++) if (list[i].num === num) return list[i];
  return null;
}

function missingViolations_() {
  var have = {};
  violations_().forEach(function (v) { have[v.num] = 1; });
  var out = [];
  for (var n = 62; n <= 77; n++) if (!have[n]) out.push(n);
  return out;
}

/** نص كل مخالفة كمادة في قاعدة المعرفة (مصدر penreg). */
function penaltyArticles_() {
  return violations_().map(function (v) {
    var lines = ['المخالفة رقم ' + v.num + ' (' + v.section + '): ' + v.text];
    v.cases.forEach(function (c) {
      var pens = c.penalties.map(function (p, i) {
        return ORDINALS[i] + ': ' + p.text + (p.uncertain ? ' (قراءة مرجّحة: الخلية شبه ممحوة في الأصل)' : '');
      }).join('، ');
      lines.push((c.label ? c.label + ' ' : '') + 'الحد الأقصى للجزاء - ' + pens + '.');
    });
    if (v.manual) lines.push('(أُدخلت يدوياً من النسخة الورقية بواسطة ' + v.entered_by + ' بتاريخ ' + v.entered_at + ')');
    return { source: 'penreg', num: String(v.num), label: 'مخالفة ' + v.num, chapter: v.section, page: v.page, also: [], text: lines.join('\n') };
  });
}

function penList_() {
  return { violations: violations_(), missing: missingViolations_(), codes: PEN_CODES, sections: PEN_SECTIONS };
}

// ---------------- التواريخ ----------------

function parseDate_(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function iso_(d) { return d.toISOString().slice(0, 10); }
function addDays_(d, n) { return new Date(d.getTime() + n * 86400000); }
function addMonths_(d, n) {
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}
function todayUtc_() {
  var t = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  return parseDate_(t);
}

// ---------------- تقييم الجزاء ----------------

function penAssessApi_(d) {
  var r = penAssess_(d);
  r.sources = sourceShorts_();
  return r;
}

function penAssess_(d) {
  var v = getViolation_(d.violation_num);
  if (!v) throw userError_('رقم المخالفة غير موجود في الجدول. يمكن لمدير النظام إدخالها من النسخة الورقية.');
  var c = v.cases[Math.min(parseInt(d.case_index || 0, 10), v.cases.length - 1)];
  var today = parseDate_(d.today) || todayUtc_();
  var notes = [], warnings = [], refs = [];
  function ref(s, a) { if (!refs.some(function (x) { return x.source === s && x.article === a; })) refs.push({ source: s, article: a }); }

  // العود (م 144): خلال سنة من إبلاغ العامل بالجزاء السابق
  var prev = parseInt(d.previous_count || 0, 10), occurrence = prev + 1;
  var notice = parseDate_(d.last_penalty_notice);
  if (prev > 0) {
    ref('labor14', '144');
    var refDate = parseDate_(d.discovered_on) || today;
    if (!notice) {
      warnings.push('لم يُدخل تاريخ إبلاغ العامل بالجزاء السابق. التشديد بسبب العود جائز فقط إذا وقعت المخالفة الجديدة خلال سنة من تاريخ إبلاغه بالجزاء السابق (مادة 144).');
    } else if (refDate > addMonths_(notice, 12)) {
      occurrence = 1;
      notes.push('مر أكثر من سنة على إبلاغ العامل بالجزاء السابق، فلا تُعامل المخالفة كعود وتُحسب كأول مرة (مادة 144).');
    }
  }
  var occ = Math.min(occurrence, 4) - 1;
  if (occurrence > 4) notes.push('المخالفة تكررت أكثر من 4 مرات؛ الجدول يحدد الحد الأقصى حتى المرة الرابعة، وطُبّق جزاء المرة الرابعة.');
  var penalty = JSON.parse(JSON.stringify(c.penalties[occ]));
  ref('penreg', String(v.num));
  if (penalty.uncertain) warnings.push('خلية هذا الجزاء شبه ممحوة في نسخة اللائحة الممسوحة، والقراءة مرجّحة؛ راجعها على النسخة الورقية قبل التوقيع.');
  if (v.manual) notes.push('هذه المخالفة أُدخلت يدوياً من النسخة الورقية بواسطة ' + v.entered_by + ' بتاريخ ' + v.entered_at + '.');

  if (penalty.code === 'A') {
    notes.push('التأخير أكثر من 60 دقيقة: يعامل العامل كغائب في هذا اليوم ولا يُسمح له بالعمل، ويُطبق عليه جزاء الغياب (المخالفة 10).');
    var absence = getViolation_(10);
    if (absence) { penalty = JSON.parse(JSON.stringify(absence.cases[0].penalties[occ])); penalty.text = 'جزاء الغياب: ' + penalty.text; }
  }

  var code = penalty.code, deduction = null;
  if (PEN_DAYS[code] !== undefined && code !== 'W') {
    ref('labor14', '143');
    var days = PEN_DAYS[code];
    var already = parseFloat(d.deducted_days_this_month || 0) || 0;
    var allowed = Math.min(days, Math.max(0, 5 - already));
    deduction = { days: days, allowed_this_month: allowed };
    var wage = parseFloat(d.daily_basic_wage || 0);
    if (wage) { deduction.amount = round2_(days * wage); deduction.allowed_amount_this_month = round2_(allowed * wage); }
    if (allowed < days) warnings.push('تم خصم ' + already + ' يوم هذا الشهر بالفعل، ولا يجوز أن يقتطع وفاءً للجزاءات أكثر من أجر 5 أيام في الشهر الواحد (مادة 143). المسموح هذا الشهر: ' + allowed + ' يوم، والباقي يُرحّل.');
    notes.push('الخصم يُحسب من الأجر الأساسي اليومي، ولا يزيد عن 5 أيام للمخالفة الواحدة (مادة 143).');
  }
  if (code === 'F') {
    ref('labor14', '148'); ref('labor14', '145');
    warnings.push('الفصل من الخدمة من اختصاص المحكمة العمالية وحدها، ولا يجوز لصاحب العمل توقيعه بنفسه (مادة 148). يجوز وقف العامل مؤقتاً بأجر كامل لمدة لا تزيد على 60 يوماً (مادة 145).');
  }
  if (code === 'R' || code === 'D') ref('labor14', '139');

  if (d.signer === 'manager') {
    ref('labor14', '148');
    if (['W', 'Q', 'H', '1', '2', '3'].indexOf(code) >= 0) notes.push('يجوز لمدير المنشأة توقيع هذا الجزاء (الإنذار الكتابي والخصم حتى 3 أيام) (مادة 148).');
    else warnings.push('مدير المنشأة يملك فقط الإنذار الكتابي والخصم حتى 3 أيام؛ هذا الجزاء يوقعه صاحب العمل أو من يفوضه (مادة 148).');
  }

  ref('labor14', '141'); ref('labor14', '138');
  var deadlines = [];
  var disc = parseDate_(d.discovered_on), start = parseDate_(d.investigation_started), end = parseDate_(d.investigation_ended);
  if (disc) {
    var startLimit = addDays_(disc, 7);
    var lateStart = (start && start > startLimit) || (!start && today > startLimit);
    deadlines.push({ label: 'آخر موعد لبدء التحقيق (7 أيام من اكتشاف المخالفة)', date: iso_(startLimit), late: lateStart });
    if (start && start > startLimit) warnings.push('بدأ التحقيق بعد أكثر من 7 أيام من اكتشاف المخالفة، بالمخالفة لمادة 141؛ هذا يعرّض الجزاء للإلغاء.');
    else if (!start && today > startLimit) warnings.push('مرت أكثر من 7 أيام على اكتشاف المخالفة دون بدء التحقيق (مادة 141).');
  }
  if (start) {
    var endLimit = addMonths_(start, 3);
    deadlines.push({ label: 'الحد الأقصى لمدة التحقيق (3 أشهر، ويجوز مدها 3 أشهر لوقائع أو مستندات جديدة)', date: iso_(endLimit), late: (end || today) > endLimit });
  }
  if (end) {
    var decision = addDays_(end, 30);
    deadlines.push({ label: 'آخر موعد لتوقيع الجزاء (30 يوماً من انتهاء التحقيق)', date: iso_(decision), late: today > decision });
    if (today > decision) warnings.push('مضى أكثر من 30 يوماً على انتهاء التحقيق؛ لا يجوز توقيع الجزاء الآن (مادة 138).');
  }
  var oral = ['W', 'Q', 'H', '1'].indexOf(code) >= 0;
  var steps = [
    'التأكد أن الفعل له صلة بالعمل (مادة 138).',
    'إبلاغ العامل كتابة بما نُسب إليه (مادة 141).',
    'سماع أقواله وتحقيق دفاعه وإثبات ذلك في محضر يودع في ملفه (مادة 141).',
    oral ? 'يجوز أن يكون التحقيق شفاهة لأن الجزاء إنذار أو خصم لا يزيد عن يوم، على أن يثبت مضمونه في قرار الجزاء (مادة 141).'
         : 'التحقيق يجب أن يكون مكتوباً لأن الجزاء أشد من إنذار أو خصم يوم (مادة 141).',
    'يتولى التحقيق الشؤون القانونية، أو شخص من ذوي الخبرة أو أحد العاملين بشرط ألا يقل مستواه الوظيفي عن مستوى العامل (مادة 142).',
    'إصدار قرار جزاء مسبب، وجزاء واحد فقط عن المخالفة الواحدة (مادتان 140 و 141).',
    'قيد الجزاء المالي في سجل الجزاءات، وتوجيه حصيلته لحساب خاص لأغراض العمال الاجتماعية (مادة 153).'
  ];
  ref('labor14', '142'); ref('labor14', '140'); ref('labor14', '153');
  return {
    violation: { num: v.num, text: v.text, section: v.section, case: c.label, page: v.page },
    occurrence: occurrence, occurrence_label: ORDINALS[occ] + (occurrence > 4 ? ' (أو أكثر)' : ''),
    max_penalty: penalty,
    all_levels: c.penalties.map(function (p, i) { return { label: ORDINALS[i], text: p.text, uncertain: p.uncertain }; }),
    deduction: deduction, deadlines: deadlines, steps: steps, notes: notes, warnings: warnings, references: refs,
    reminder: 'الجدول يحدد الحد الأقصى؛ يجوز توقيع جزاء أخف بما يحقق التناسب مع المخالفة (مادة 138).'
  };
}

function round2_(x) { return Math.round(x * 100) / 100; }

// ---------------- إدخال وتصحيح المخالفات (للمدير) ----------------

function adminPenSave_(d, admin) {
  var num = parseInt(d.num, 10);
  if (!(num >= 1 && num <= 200)) throw userError_('رقم المخالفة غير صحيح');
  if (!d.text || String(d.text).trim().length < 5) throw userError_('اكتب نص المخالفة كما في اللائحة');
  var codes = [d.c1, d.c2, d.c3, d.c4];
  if (codes.some(function (c) { return !PEN_CODES[c]; })) throw userError_('اختر الجزاء في المرات الأربع');
  if (PEN_SECTIONS.indexOf(d.section) < 0) throw userError_('اختر القسم');
  var old = getViolation_(num);
  var sh = sheet_('Penalties');
  // حذف الصفوف القديمة لنفس الرقم ثم إضافة الصف الجديد
  readRows_('Penalties').filter(function (r) { return parseInt(r.num, 10) === num; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (row) { sh.deleteRow(row); });
  appendRow_('Penalties', { num: num, section: d.section, text: String(d.text).trim(), case_label: '',
    first: PEN_CODES[codes[0]], second: PEN_CODES[codes[1]], third: PEN_CODES[codes[2]], fourth: PEN_CODES[codes[3]],
    uncertain: '', page: old && old.page ? old.page : '', manual: true, entered_by: admin.full_name,
    entered_at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm') });
  sortPenalties_();
  violations_.memo = null;
  kbReset_();
  return { done: true };
}

function adminPenDelete_(d) {
  var num = parseInt(d.num, 10);
  var sh = sheet_('Penalties');
  var rows = readRows_('Penalties').filter(function (r) { return parseInt(r.num, 10) === num && (r.manual === true || r.manual === 'TRUE'); });
  if (!rows.length) throw userError_('لا يوجد إدخال يدوي لهذه المخالفة');
  rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { sh.deleteRow(row); });
  violations_.memo = null;
  kbReset_();
  return { done: true };
}

function sortPenalties_() {
  var sh = sheet_('Penalties');
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).sort({ column: 1, ascending: true });
}
