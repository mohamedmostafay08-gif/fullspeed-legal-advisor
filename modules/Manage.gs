/**
 * إدارة القوانين من داخل البرنامج (مدير النظام فقط):
 * إضافة مرجع جديد، تعديل بياناته، إضافة/تعديل/حذف مواد، لصق نص كامل وتقسيمه تلقائياً،
 * أو رفع صورة/PDF واستخراج المواد منها بالذكاء الاصطناعي ثم مراجعتها قبل الحفظ.
 * لائحة الجزاءات (penreg) تُدار من قسم "مخالفات لائحة الجزاءات" لأنها جدول له أعمدة خاصة.
 */

var AR_ORDINALS = {
  'الاولى': 1, 'الأولى': 1, 'الثانية': 2, 'الثالثة': 3, 'الرابعة': 4, 'الخامسة': 5, 'السادسة': 6, 'السابعة': 7,
  'الثامنة': 8, 'التاسعة': 9, 'العاشرة': 10
};

function cleanArticleInput_(a) {
  a = a || {};
  var num = normNum_(String(a.num || '').trim());
  var ord = AR_ORDINALS[num];
  if (ord) num = String(ord);
  var text = String(a.text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  var label = String(a.label || '').trim() || (num ? 'مادة (' + num + ')' : '');
  return { num: num, label: label, chapter: String(a.chapter || '').trim(), text: text };
}

/**
 * يقسم نصاً ملصوقاً إلى مواد. يتعرف على: "مادة (5)"، "المادة 5"، "مادة ٥ مكرر"، "المادة الخامسة"،
 * ويلتقط عناوين الأبواب والفصول كـ chapter. إذا لم توجد عناوين مواد يعيد مادة واحدة بالنص كله.
 */
function splitArticlesText_(text) {
  text = String(text || '').replace(/\r\n?/g, '\n');
  var lines = text.split('\n');
  var headRe = /^\s*[\(\[]?\s*(?:ال)?مادة\s*[\(\[]?\s*([0-9٠-٩]+(?:\s*مكرر(?:\s*[\(\[]?[أا-ي]?[\)\]]?)?)?|[ء-ي]+(?:\s+[ء-ي]+)?)\s*[\)\]]?\s*[:\-–]?\s*(.*)$/;
  var chapRe = /^\s*(?:ال)?(?:باب|فصل|الكتاب|كتاب|القسم|قسم)\s+\S+/;
  var out = [], cur = null, chapter = '', pre = [];
  lines.forEach(function (line) {
    var m = line.match(headRe);
    if (m && line.trim().length < 120) {
      var raw = arDigits_(m[1]).trim();
      var num = AR_ORDINALS[raw] ? String(AR_ORDINALS[raw]) : (/^\d/.test(raw) ? raw.replace(/\s+/g, ' ') : null);
      if (num) {
        if (cur) out.push(cur);
        cur = { num: num, label: line.trim().replace(/[:\-–]\s*$/, '').slice(0, 60), chapter: chapter, text: m[2] ? m[2].trim() : '' };
        if (cur.text) cur.label = 'مادة (' + num + ')';
        return;
      }
    }
    if (chapRe.test(line) && line.trim().length < 100) { chapter = line.trim(); if (!cur) return; }
    if (cur) cur.text += (cur.text ? '\n' : '') + line;
    else pre.push(line);
  });
  if (cur) out.push(cur);
  if (!out.length && text.trim()) out.push({ num: '1', label: 'نص', chapter: '', text: text.trim() });
  return out.map(cleanArticleInput_).filter(function (a) { return a.num && a.text; });
}

function checkEditableSource_(id) {
  id = String(id || '').trim();
  if (id === 'penreg') throw userError_('لائحة الجزاءات تُعدّل من قسم "مخالفات لائحة الجزاءات" في صفحة الإدارة');
  if (!kbData_().sources[id]) throw userError_('المرجع غير موجود');
  return id;
}

/** إضافة مرجع جديد أو تعديل بيانات مرجع موجود. */
function adminSourceSave_(d) {
  var id = String(d.id || '').trim().toLowerCase();
  var title = String(d.title || '').trim(), short = String(d.short || '').trim();
  if (!title || title.length < 4) throw userError_('اكتب اسم القانون أو اللائحة كاملاً');
  if (!short) short = title.slice(0, 30);
  var rows = readRows_('Sources');
  var found = null;
  rows.forEach(function (r) { if (String(r.id) === id) found = r; });
  if (d.isNew) {
    if (!id) id = 'src' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyMMddHHmm');
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(id)) throw userError_('الرمز بالإنجليزي فقط (حروف وأرقام)، مثل: law12');
    if (found) throw userError_('هذا الرمز مستخدم لمرجع آخر');
    appendRow_('Sources', { id: id, title: title, short: short, citation: String(d.citation || '').trim() || title,
                            pdf: '', notes: String(d.notes || '').trim() });
  } else {
    if (!found) throw userError_('المرجع غير موجود');
    updateRow_('Sources', found._row, { title: title, short: short, citation: String(d.citation || '').trim() || title,
                                         notes: String(d.notes || '').trim() });
  }
  kbReset_();
  return { done: true, id: id };
}

/** حذف مرجع أضافه المدير مع كل مواده (المراجع الأساسية لا تُحذف). */
function adminSourceDelete_(d) {
  var id = checkEditableSource_(d.id);
  if (SOURCE_ORDER.indexOf(id) >= 0) throw userError_('لا يمكن حذف المراجع الأساسية، يمكنك تعديل موادها فقط');
  deleteArticleRows_(function (r) { return String(r.source) === id; });
  var src = readRows_('Sources').filter(function (r) { return String(r.id) === id; });
  src.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (row) { sheet_('Sources').deleteRow(row); });
  kbReset_();
  return { done: true };
}

function deleteArticleRows_(pred) {
  var sh = sheet_('Articles');
  var rows = readRows_('Articles').filter(pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  rows.forEach(function (row) { sh.deleteRow(row); });
  return rows.length;
}

/**
 * حفظ مادة واحدة أو مجموعة مواد في مرجع.
 * d.articles: [{num,label,chapter,text}] — المادة الموجودة بنفس الرقم تُستبدل، والجديدة تُضاف.
 * d.origNum: عند تعديل رقم مادة موجودة.
 */
function adminArticlesSave_(d) {
  var source = checkEditableSource_(d.source);
  var list = (d.articles || []).map(cleanArticleInput_);
  if (!list.length) throw userError_('لا توجد مواد للحفظ');
  if (list.length > 400) throw userError_('الحد الأقصى 400 مادة في المرة الواحدة');
  list.forEach(function (a) {
    if (!a.num) throw userError_('كل مادة تحتاج رقماً');
    if (a.text.length < 3) throw userError_('نص المادة ' + a.num + ' فارغ');
    if (a.text.length > 45000) throw userError_('نص المادة ' + a.num + ' أطول من المسموح (45 ألف حرف)');
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_('Articles'), head = SHEETS.Articles;
    if (d.origNum !== undefined && d.origNum !== null && String(d.origNum) !== list[0].num) {
      var orig = normNum_(d.origNum);
      deleteArticleRows_(function (r) { return String(r.source) === source && normNum_(r.num) === orig; });
    }
    var existing = {};
    readRows_('Articles').forEach(function (r) { if (String(r.source) === source) existing[normNum_(r.num)] = r; });
    var added = 0, updated = 0, fresh = [];
    list.forEach(function (a) {
      var row = { source: source, num: a.num, label: a.label, chapter: a.chapter, page: '', also_contains: '', text: a.text };
      var old = existing[a.num];
      if (old) {
        row.page = old.page; // نحتفظ برقم الصفحة في الملف الأصلي
        sh.getRange(old._row, 1, 1, head.length).setValues([head.map(function (h) { return row[h]; })]);
        updated++;
      } else {
        fresh.push(head.map(function (h) { return row[h]; }));
        existing[a.num] = { _row: -1 };
        added++;
      }
    });
    if (fresh.length) {
      sh.getRange(sh.getLastRow() + 1, 1, fresh.length, head.length).setNumberFormat('@').setValues(fresh);
    }
    kbReset_();
    return { added: added, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function adminArticleDelete_(d) {
  var source = checkEditableSource_(d.source), num = normNum_(d.num);
  var n = deleteArticleRows_(function (r) { return String(r.source) === source && normNum_(r.num) === num; });
  if (!n) throw userError_('المادة غير موجودة');
  kbReset_();
  return { done: true };
}

/** رفع جزء من صورة/PDF (base64) لاستخراج نصه. */
function adminExtractUpload_(d, admin) {
  return uploadChunk_('ext_' + admin.username + '_', d);
}
