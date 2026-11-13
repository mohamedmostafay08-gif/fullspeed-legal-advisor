/**
 * طبقة البيانات: كل البيانات في جداول (Sheets) داخل نفس ملف Google Sheets.
 * النصوص القانونية تُقرأ مرة وتُخزن مؤقتاً في CacheService لتسريع الطلبات.
 */

var SHEETS = {
  Sources:   ['id', 'title', 'short', 'citation', 'pdf', 'notes'],
  Articles:  ['source', 'num', 'label', 'chapter', 'page', 'also_contains', 'text'],
  Penalties: ['num', 'section', 'text', 'case_label', 'first', 'second', 'third', 'fourth', 'uncertain', 'page', 'manual', 'entered_by', 'entered_at'],
  Users:     ['username', 'full_name', 'role', 'salt', 'hash', 'active', 'created_at', 'last_login', 'email', 'favorites'],
  Questions: ['id', 'time', 'username', 'mode', 'question', 'provider', 'model', 'answer_json', 'verification_json', 'feedback', 'feedback_note', 'redactions'],
  Documents: ['time', 'username', 'doc_type', 'employee', 'doc_url', 'pdf_url'],
  Settings:  ['key', 'value']
};

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setRightToLeft(false); // الجداول من الشمال لليمين
  } else if (!sheet_.checked[name]) {
    // ترقية: إضافة الأعمدة الجديدة لجداول قديمة (تُضاف دائماً في آخر الجدول)
    var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    var missing = SHEETS[name].filter(function (h) { return head.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, head.filter(String).length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  sheet_.checked[name] = true;
  return sh;
}

sheet_.checked = {};

function ensureSheets_() {
  Object.keys(SHEETS).forEach(function (n) { sheet_(n); });
}

/** كل صفوف جدول كقائمة كائنات (المفاتيح من صف العناوين). */
function readRows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var head = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r.join('') === '') continue;
    var o = { _row: i + 1 };
    for (var j = 0; j < head.length; j++) o[head[j]] = r[j];
    rows.push(o);
  }
  return rows;
}

function appendRow_(name, obj) {
  var sh = sheet_(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; // ترتيب أعمدة الجدول الفعلي
  sh.appendRow(head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function updateRow_(name, rowNum, obj) {
  var sh = sheet_(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  head.forEach(function (h, j) {
    if (obj[h] !== undefined) sh.getRange(rowNum, j + 1).setValue(obj[h]);
  });
}

// ---------------- الإعدادات ----------------

function getSetting_(key, def) {
  var cache = CacheService.getScriptCache();
  var c = cache.get('set_' + key);
  if (c !== null) return c === '__none__' ? def : JSON.parse(c);
  var rows = readRows_('Settings');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      var v;
      try { v = JSON.parse(rows[i].value); } catch (e) { v = rows[i].value; }
      cache.put('set_' + key, JSON.stringify(v), 21600);
      return v;
    }
  }
  cache.put('set_' + key, '__none__', 600);
  return def;
}

function setSetting_(key, value) {
  var rows = readRows_('Settings');
  var str = typeof value === 'string' ? value : JSON.stringify(value);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      updateRow_('Settings', rows[i]._row, { value: str });
      CacheService.getScriptCache().remove('set_' + key);
      return;
    }
  }
  appendRow_('Settings', { key: key, value: str });
  CacheService.getScriptCache().remove('set_' + key);
}

// ---------------- استيراد ملف البيانات (القوانين واللوائح وجدول الجزاءات) ----------------
// يُرفع الملف من المتصفح على أجزاء (كل جزء أقل من 90 ألف حرف) ثم يُجمع ويُكتب في الجداول.

var DATA_SHEETS = ['Sources', 'Articles', 'Penalties'];

function uploadChunk_(prefix, d) {
  var i = parseInt(d.index, 10), n = parseInt(d.total, 10);
  if (!(n > 0 && n <= 120 && i >= 0 && i < n)) throw userError_('جزء غير صالح من ملف البيانات');
  var chunk = String(d.chunk || '');
  if (chunk.length > 90000) throw userError_('جزء أكبر من المسموح');
  CacheService.getScriptCache().put(prefix + i, chunk, 3600);
  return { received: i };
}

/** يجمع أجزاء ملف مرفوع من الكاش كنص واحد ويمسحها. */
function assembleRaw_(prefix, total) {
  if (!(total > 0 && total <= 120)) throw userError_('لم يكتمل رفع الملف، أعد المحاولة');
  var cache = CacheService.getScriptCache(), s = '', keys = [];
  for (var i = 0; i < total; i++) {
    var part = cache.get(prefix + i);
    if (part === null) throw userError_('لم يكتمل رفع الملف، أعد المحاولة');
    s += part;
    keys.push(prefix + i);
  }
  cache.removeAll(keys);
  return s;
}

function assembleUpload_(prefix, total) {
  var s = assembleRaw_(prefix, total);
  var data;
  try { data = JSON.parse(s); } catch (e) { throw userError_('ملف البيانات غير صالح. اختر الملف FullSpeed_Legal_Data.json'); }
  if (!data.Articles || !data.Penalties || !data.Sources || data.Articles.length < 100) throw userError_('ملف البيانات غير مكتمل');
  return data;
}

/** يكتب القوانين واللوائح وجدول الجزاءات في الجداول (يستبدل محتواها)، ويضيف الإعدادات الافتراضية. */
function importData_(data) {
  ensureSheets_();
  DATA_SHEETS.forEach(function (name) {
    var sh = sheet_(name), head = SHEETS[name], rows = data[name] || [];
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), head.length)).clearContent();
    if (rows.length) {
      var values = rows.map(function (r) { var x = r.slice(0, head.length); while (x.length < head.length) x.push(''); return x; });
      sh.getRange(2, 1, values.length, head.length).setValues(values);
    }
  });
  // قوائم منسدلة في جدول الجزاءات لتسهيل إدخال المخالفات الناقصة يدوياً
  var pen = sheet_('Penalties');
  var labels = Object.keys(PEN_CODES).map(function (k) { return PEN_CODES[k]; });
  pen.getRange('E2:H400').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(labels, true).setAllowInvalid(false).build());
  pen.getRange('B2:B400').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PEN_SECTIONS, true).setAllowInvalid(false).build());
  var settings = {};
  readRows_('Settings').forEach(function (r) { settings[r.key] = 1; });
  (data.Settings || []).forEach(function (kv) { if (!settings[kv[0]]) appendRow_('Settings', { key: kv[0], value: kv[1] }); });
  CacheService.getScriptCache().removeAll(['set_company_name', 'set_gemini_model']);
  clearKbCache_();
  return { articles: (data.Articles || []).length, penalties: (data.Penalties || []).length };
}

function hasData_() {
  return sheet_('Articles').getLastRow() > 100;
}

// ---------------- كاش مقسّم للبيانات الكبيرة ----------------
// CacheService يقبل حتى 100 كيلوبايت للمفتاح الواحد، فنقسم البيانات الكبيرة على عدة مفاتيح.

function cacheGetBig_(key) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(key + '_n');
  if (!meta) return null;
  var n = parseInt(meta, 10);
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var parts = cache.getAll(keys);
  var s = '';
  for (var k = 0; k < n; k++) {
    if (parts[key + '_' + k] === undefined) return null;
    s += parts[key + '_' + k];
  }
  return JSON.parse(s);
}

function cachePutBig_(key, obj) {
  var s = JSON.stringify(obj);
  var size = 90000;
  var map = {};
  var n = Math.ceil(s.length / size);
  for (var i = 0; i < n; i++) map[key + '_' + i] = s.substr(i * size, size);
  map[key + '_n'] = String(n);
  try { CacheService.getScriptCache().putAll(map, 21600); } catch (e) { console.warn('cache put failed: ' + e); }
}

function cacheClearBig_(key) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(key + '_n');
  if (!meta) return;
  var keys = [key + '_n'];
  for (var i = 0; i < parseInt(meta, 10); i++) keys.push(key + '_' + i);
  cache.removeAll(keys);
}
