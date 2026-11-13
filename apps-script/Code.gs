/**
 * ============================================================================
 *  المستشار القانوني — Full Speed
 *  ملف الكود الكامل (Code.gs). الملف الثاني هو Index.html.
 *  لا تعدّل هذا الملف يدوياً؛ هو ناتج دمج ملفات المجلد modules (python build.py).
 *  Powered by Mohamed Mostafa — 01120339097
 * ============================================================================
 */


// ############################################################################
// ## Code
// ############################################################################

/**
 * المستشار القانوني — Full Speed
 * نقطة الدخول للتطبيق (Web App) وموزّع الطلبات.
 *
 * كل طلب من الواجهة يمر عبر api(req) حيث:
 *   req = { action: "...", token: "...", data: {...} }
 * ويتم التحقق من الجلسة والصلاحية قبل تنفيذ أي إجراء.
 */

var APP_NAME = 'المستشار القانوني';

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle(APP_NAME + ' | ' + getSetting_('company_name', 'Full Speed'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * نقطة الاتصال للتطبيق المستقل (GitHub Pages): نفس api() بالظبط لكن عبر POST.
 * الطلب: نص JSON { action, token, data } — والرد JSON { ok, data | error }.
 */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = api({ action: String(req.action || ''), token: req.token || null, data: req.data || {} });
  } catch (err) {
    out = { ok: false, error: 'الطلب غير مفهوم' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** يُستخدم داخل القوالب لتضمين ملفات HTML أخرى. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// الإجراءات المتاحة: [الدالة، الصلاحية المطلوبة]
// public: بدون تسجيل دخول، user: أي مستخدم مسجل، admin: مدير النظام فقط
// (تُبنى عند أول طلب لأن Apps Script يحمّل الملفات بالترتيب، والدوال معرّفة في ملفات أخرى)
function routes_() {
  return {
  // الدخول
  'auth.status':        [authStatus_, 'public'],
  'auth.setup':         [authSetup_, 'public'],
  'setup.upload':       [setupUpload_, 'public'],
  'auth.login':         [authLogin_, 'public'],
  'auth.logout':        [authLogout_, 'user'],
  'auth.me':            [authMe_, 'user'],
  'auth.changePassword':[authChangePassword_, 'user'],
  // السؤال والجواب
  'ask':                [askQuestion_, 'user'],
  'feedback':           [saveFeedback_, 'user'],
  'history':            [listHistory_, 'user'],
  'history.get':        [getHistoryItem_, 'user'],
  // القوانين
  'kb.sources':         [kbSources_, 'user'],
  'kb.search':          [kbSearchApi_, 'user'],
  'kb.article':         [kbArticleApi_, 'user'],
  'kb.list':            [kbListApi_, 'user'],
  // الجزاءات
  'pen.list':           [penList_, 'user'],
  'pen.assess':         [penAssessApi_, 'user'],
  // الحاسبات
  'calc':               [calcApi_, 'user'],
  // المستندات
  'docs.fields':        [docsFields_, 'user'],
  'docs.generate':      [docsGenerate_, 'user'],
  'docs.recent':        [docsRecent_, 'user'],
  // الإدارة
  'admin.overview':     [adminOverview_, 'admin'],
  'admin.userCreate':   [adminUserCreate_, 'admin'],
  'admin.userToggle':   [adminUserToggle_, 'admin'],
  'admin.userPassword': [adminUserPassword_, 'admin'],
  'admin.userDelete':   [adminUserDelete_, 'admin'],
  'admin.saveSettings': [adminSaveSettings_, 'admin'],
  'admin.saveApiKey':   [adminSaveApiKey_, 'admin'],
  'admin.testAi':       [adminTestAi_, 'admin'],
  'admin.penSave':      [adminPenSave_, 'admin'],
  'admin.penDelete':    [adminPenDelete_, 'admin'],
  'admin.upload':       [adminUpload_, 'admin'],
  'admin.importData':   [adminImportData_, 'admin'],
  // تعديل القوانين من البرنامج
  'admin.sourceSave':    [adminSourceSave_, 'admin'],
  'admin.sourceDelete':  [adminSourceDelete_, 'admin'],
  'admin.articlesSave':  [adminArticlesSave_, 'admin'],
  'admin.articleDelete': [adminArticleDelete_, 'admin'],
  'admin.splitText':     [adminSplitText_, 'admin'],
  'admin.extractUpload': [adminExtractUpload_, 'admin'],
  'admin.extract':       [adminExtract_, 'admin']
  };
}

function api(req) {
  try {
    req = req || {};
    var route = routes_()[req.action];
    if (!route) return { ok: false, error: 'إجراء غير معروف' };
    var user = null;
    if (route[1] !== 'public') {
      user = sessionUser_(req.token);
      if (!user) return { ok: false, error: 'انتهت الجلسة، سجّل الدخول مرة أخرى', auth: false };
      if (route[1] === 'admin' && user.role !== 'admin') return { ok: false, error: 'هذا الإجراء لمدير النظام فقط' };
    }
    var result = route[0](req.data || {}, user, req.token);
    return { ok: true, data: result };
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: (e && e.userMessage) || ('حدث خطأ: ' + (e && e.message ? e.message : e)) };
  }
}

/** خطأ برسالة واضحة تُعرض للمستخدم. */
function userError_(msg) {
  var e = new Error(msg);
  e.userMessage = msg;
  return e;
}

/**
 * شغّل هذه الدالة مرة واحدة من محرر Apps Script (زر Run) لإنشاء كود الإعداد الأول.
 * سيظهر الكود في سجل التنفيذ (Execution log)، واستخدمه لإنشاء حساب المدير من صفحة الدخول.
 */
function createSetupCode() {
  var code = Utilities.getUuid().split('-')[0].toUpperCase();
  PropertiesService.getScriptProperties().setProperty('SETUP_CODE', code);
  ensureSheets_();
  console.log('كود الإعداد الأول: ' + code);
  return code;
}


// ############################################################################
// ## Store
// ############################################################################

/**
 * طبقة البيانات: كل البيانات في جداول (Sheets) داخل نفس ملف Google Sheets.
 * النصوص القانونية تُقرأ مرة وتُخزن مؤقتاً في CacheService لتسريع الطلبات.
 */

var SHEETS = {
  Sources:   ['id', 'title', 'short', 'citation', 'pdf', 'notes'],
  Articles:  ['source', 'num', 'label', 'chapter', 'page', 'also_contains', 'text'],
  Penalties: ['num', 'section', 'text', 'case_label', 'first', 'second', 'third', 'fourth', 'uncertain', 'page', 'manual', 'entered_by', 'entered_at'],
  Users:     ['username', 'full_name', 'role', 'salt', 'hash', 'active', 'created_at', 'last_login'],
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
  }
  return sh;
}

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
  var head = SHEETS[name];
  sheet_(name).appendRow(head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
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


// ############################################################################
// ## Auth
// ############################################################################

/**
 * الحسابات والدخول.
 * - المستخدمون يُنشئهم مدير النظام فقط (اسم مستخدم + كلمة مرور)، بحد أقصى 5 حسابات.
 * - كلمات المرور تُخزن مشفّرة (SHA-256 مكرر مع ملح عشوائي)، ولا تُخزن كنص أبداً.
 * - الجلسة: رمز عشوائي صالح 6 ساعات من آخر استخدام.
 * - بعد 5 محاولات دخول خاطئة يُقفل الحساب 15 دقيقة.
 */

var MAX_USERS = 5;
var SESSION_SECONDS = 6 * 60 * 60;
var HASH_ROUNDS = 500;

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  for (var i = 0; i < HASH_ROUNDS; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest.concat(Utilities.newBlob(salt).getBytes()));
  }
  return Utilities.base64Encode(digest);
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function findUser_(username) {
  username = String(username || '').trim().toLowerCase();
  var rows = readRows_('Users');
  for (var i = 0; i < rows.length; i++) if (String(rows[i].username).toLowerCase() === username) return rows[i];
  return null;
}

function publicUser_(u) {
  return { username: u.username, full_name: u.full_name, role: u.role, active: u.active === true || u.active === 'TRUE',
           created_at: u.created_at ? String(u.created_at) : '', last_login: u.last_login ? String(u.last_login) : '' };
}

function validatePassword_(p) {
  if (!p || String(p).length < 8) throw userError_('كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (!/[0-9]/.test(p) || !/[^0-9]/.test(p)) throw userError_('كلمة المرور يجب أن تحتوي على أرقام وحروف');
}

function validateUsername_(u) {
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(u || '')) throw userError_('اسم المستخدم: من 3 إلى 30 حرفاً إنجليزياً أو أرقام، بدون مسافات');
}

// ---------------- الجلسات ----------------

function sessionUser_(token) {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
  var cache = CacheService.getScriptCache();
  var username = cache.get('sess_' + token);
  if (!username) return null;
  var u = findUser_(username);
  if (!u || !(u.active === true || u.active === 'TRUE')) return null;
  cache.put('sess_' + token, username, SESSION_SECONDS); // تجديد مدة الجلسة مع كل استخدام
  return publicUser_(u);
}

function newToken_() {
  var t = '';
  while (t.length < 48) t += Utilities.getUuid().replace(/-/g, '');
  return t.slice(0, 48);
}

// ---------------- الإجراءات ----------------

function authStatus_() {
  ensureSheets_();
  return { hasUsers: readRows_('Users').length > 0, hasData: hasData_(), company: getSetting_('company_name', 'Full Speed') };
}

function checkSetupCode_(given) {
  if (readRows_('Users').length > 0) throw userError_('تم إعداد النظام بالفعل');
  var code = PropertiesService.getScriptProperties().getProperty('SETUP_CODE');
  if (!code) throw userError_('لم يتم إنشاء كود الإعداد. شغّل الدالة createSetupCode من محرر Apps Script أولاً.');
  if (String(given || '').trim().toUpperCase() !== code) throw userError_('كود الإعداد غير صحيح');
}

/** رفع جزء من ملف البيانات أثناء الإعداد الأول (محمي بكود الإعداد). */
function setupUpload_(d) {
  checkSetupCode_(d.setupCode);
  return uploadChunk_('setup_up_', d);
}

/** رفع ملف بيانات جديد لاحقاً (لمدير النظام) لتحديث القوانين. */
function adminUpload_(d, admin) {
  return uploadChunk_('admin_up_' + admin.username + '_', d);
}

function adminImportData_(d, admin) {
  var data = assembleUpload_('admin_up_' + admin.username + '_', parseInt(d.total, 10));
  return importData_(data);
}

function authSetup_(d) {
  ensureSheets_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    checkSetupCode_(d.setupCode);
    validateUsername_(d.username);
    validatePassword_(d.password);
    if (!d.fullName || String(d.fullName).trim().length < 2) throw userError_('اكتب الاسم الكامل');
    var imported = null;
    if (d.dataParts) imported = importData_(assembleUpload_('setup_up_', parseInt(d.dataParts, 10)));
    else if (!hasData_()) throw userError_('اختر ملف البيانات FullSpeed_Legal_Data.json');
    var salt = newSalt_();
    appendRow_('Users', { username: d.username.trim().toLowerCase(), full_name: d.fullName.trim(), role: 'admin',
                          salt: salt, hash: hashPassword_(d.password, salt), active: true, created_at: new Date() });
    PropertiesService.getScriptProperties().deleteProperty('SETUP_CODE');
    return { done: true, imported: imported };
  } finally {
    lock.releaseLock();
  }
}

function authLogin_(d) {
  var username = String(d.username || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + username;
  var fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= 5) throw userError_('تم إيقاف الدخول لهذا الحساب 15 دقيقة بسبب محاولات خاطئة متكررة');
  var u = findUser_(username);
  var ok = u && (u.active === true || u.active === 'TRUE') && safeEqual_(hashPassword_(String(d.password || ''), u.salt), u.hash);
  if (!ok) {
    cache.put(failKey, String(fails + 1), 900);
    Utilities.sleep(600);
    throw userError_('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  cache.remove(failKey);
  var token = newToken_();
  cache.put('sess_' + token, u.username, SESSION_SECONDS);
  updateRow_('Users', u._row, { last_login: new Date() });
  return { token: token, user: publicUser_(u) };
}

function authLogout_(d, user, token) {
  CacheService.getScriptCache().remove('sess_' + token);
  return { done: true };
}

function authMe_(d, user) {
  var me = {};
  Object.keys(user).forEach(function (k) { me[k] = user[k]; });
  me.company = getSetting_('company_name', 'Full Speed');
  return me;
}

function authChangePassword_(d, user) {
  var u = findUser_(user.username);
  if (!safeEqual_(hashPassword_(String(d.oldPassword || ''), u.salt), u.hash)) throw userError_('كلمة المرور الحالية غير صحيحة');
  validatePassword_(d.newPassword);
  var salt = newSalt_();
  updateRow_('Users', u._row, { salt: salt, hash: hashPassword_(d.newPassword, salt) });
  return { done: true };
}

// ---------------- إدارة المستخدمين (للمدير) ----------------

function adminUserCreate_(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var users = readRows_('Users');
    if (users.length >= MAX_USERS) throw userError_('الحد الأقصى ' + MAX_USERS + ' حسابات. احذف أو عدّل حساباً موجوداً.');
    validateUsername_(d.username);
    validatePassword_(d.password);
    if (findUser_(d.username)) throw userError_('اسم المستخدم موجود بالفعل');
    if (!d.fullName || String(d.fullName).trim().length < 2) throw userError_('اكتب الاسم الكامل');
    var salt = newSalt_();
    appendRow_('Users', { username: d.username.trim().toLowerCase(), full_name: String(d.fullName).trim(),
                          role: d.role === 'admin' ? 'admin' : 'user', salt: salt, hash: hashPassword_(d.password, salt),
                          active: true, created_at: new Date() });
    return { done: true };
  } finally {
    lock.releaseLock();
  }
}

function adminUserToggle_(d, admin) {
  var u = findUser_(d.username);
  if (!u) throw userError_('المستخدم غير موجود');
  if (u.username === admin.username) throw userError_('لا يمكنك إيقاف حسابك');
  var active = !(u.active === true || u.active === 'TRUE');
  updateRow_('Users', u._row, { active: active });
  return { active: active };
}

function adminUserPassword_(d) {
  var u = findUser_(d.username);
  if (!u) throw userError_('المستخدم غير موجود');
  validatePassword_(d.password);
  var salt = newSalt_();
  updateRow_('Users', u._row, { salt: salt, hash: hashPassword_(d.password, salt) });
  return { done: true };
}

function adminUserDelete_(d, admin) {
  var u = findUser_(d.username);
  if (!u) throw userError_('المستخدم غير موجود');
  if (u.username === admin.username) throw userError_('لا يمكنك حذف حسابك');
  sheet_('Users').deleteRow(u._row);
  return { done: true };
}


// ############################################################################
// ## KbDict
// ############################################################################

// قواميس البحث العربي (مولّدة من النسخة الأولى - لا تعدّلها يدوياً إلا للإضافة)
var KB_DICT = {
 "SYNONYMS": {
  "موظف": "عامل",
  "موظفه": "عامل",
  "موظفين": "عمال",
  "الموظف": "عامل",
  "الموظفين": "عمال",
  "شغال": "عامل",
  "عماله": "عمال",
  "مدير": "رييس",
  "المدير": "رييس",
  "مديره": "رييس",
  "شركه": "منشاه",
  "الشركه": "منشاه",
  "مؤسسه": "منشاه",
  "مرتب": "اجر",
  "المرتب": "اجر",
  "راتب": "اجر",
  "الراتب": "اجر",
  "مرتبات": "اجور",
  "قبض": "اجر",
  "غاب": "غياب",
  "غايب": "غياب",
  "يغيب": "غياب",
  "تغيب": "غياب",
  "اتغيب": "غياب",
  "غابت": "غياب",
  "انقطع": "انقطاع",
  "منقطع": "انقطاع",
  "اتاخر": "تاخير",
  "تاخر": "تاخير",
  "متاخر": "تاخير",
  "اتأخر": "تاخير",
  "تاخرت": "تاخير",
  "تاخيرات": "تاخير",
  "مشي": "انصراف",
  "مشى": "انصراف",
  "روح": "انصراف",
  "خرج": "انصراف",
  "زوغ": "انصراف",
  "استاذن": "اذن",
  "بصمه": "الحضور",
  "البصمه": "الحضور",
  "بصم": "الحضور",
  "يبصم": "الحضور",
  "حضور": "الحضور",
  "رفد": "فصل",
  "يترفد": "فصل",
  "اترفد": "فصل",
  "طرد": "فصل",
  "يطرد": "فصل",
  "رفده": "فصل",
  "نفصله": "فصل",
  "فصله": "فصل",
  "خصومات": "خصم",
  "الخصم": "خصم",
  "للخصم": "خصم",
  "خصم": "خصم",
  "نخصم": "خصم",
  "يتخصم": "خصم",
  "اخصم": "خصم",
  "جزاءات": "جزاء",
  "عقوبه": "جزاء",
  "عقوبات": "جزاء",
  "نحقق": "تحقيق",
  "التحقيق": "تحقيق",
  "انذارات": "انذار",
  "لفت": "انذار",
  "زوغان": "انصراف",
  "سرقه": "اختلاس",
  "سرق": "اختلاس",
  "يمضي": "التوقيع",
  "امضي": "التوقيع",
  "يمضى": "التوقيع",
  "يوقع": "التوقيع",
  "مضي": "التوقيع",
  "امضاء": "التوقيع",
  "يستغل": "استعمال",
  "استغل": "استعمال",
  "استغلال": "استعمال",
  "سلطته": "السلطات",
  "سلطه": "السلطات",
  "صلاحياته": "السلطات",
  "ولاده": "الوضع",
  "حامل": "الوضع",
  "حمل": "الوضع",
  "اوفرتايم": "اضافي",
  "اوفر": "اضافي",
  "سهر": "اضافي",
  "سهرنا": "اضافي",
  "شيفت": "ساعات",
  "وردية": "ساعات",
  "ورديه": "ساعات",
  "اجازات": "اجازه",
  "اجازته": "اجازه",
  "عارضه": "عارضه",
  "مرضي": "مرضيه",
  "عيان": "مرض",
  "تعبان": "مرض",
  "لابتوب": "اجهزه",
  "موبايل": "تليفون",
  "الموبايل": "تليفون",
  "الفون": "تليفون",
  "تليفونه": "تليفون",
  "كسر": "اتلاف",
  "بوظ": "اتلاف",
  "ضيع": "فقد",
  "ضاع": "فقد",
  "عهدته": "عهده",
  "شات": "الذكاء",
  "chatgpt": "الذكاء",
  "gpt": "الذكاء",
  "جيميناي": "الذكاء",
  "ai": "الذكاء",
  "بوت": "الذكاء",
  "باسورد": "المرور",
  "الباسورد": "المرور",
  "اكونت": "حسابات",
  "الاكونت": "حسابات",
  "ايميل": "البريد",
  "الايميل": "البريد",
  "فيسبوك": "التواصل",
  "سوشيال": "التواصل",
  "صور": "تصوير",
  "صوّر": "تصوير",
  "سجل": "تسجيل",
  "التامينات": "تامين",
  "تامينات": "تامين"
 },
 "STOPWORDS": [
  "احنا",
  "اذا",
  "التي",
  "الذي",
  "اللي",
  "الي",
  "ان",
  "انا",
  "او",
  "اي",
  "ايه",
  "بتاع",
  "بتاعه",
  "بدون",
  "بعد",
  "بيه",
  "دا",
  "ده",
  "دون",
  "دي",
  "ذلك",
  "عايز",
  "علي",
  "عن",
  "عند",
  "غير",
  "في",
  "فيه",
  "قبل",
  "كام",
  "كان",
  "كل",
  "لا",
  "لم",
  "لو",
  "ما",
  "ماذا",
  "محتاج",
  "مع",
  "من",
  "هذا",
  "هذه",
  "هل",
  "هو",
  "هي",
  "و",
  "واحد",
  "يجوز",
  "يعني",
  "يكون"
 ],
 "PREFIXES": [
  "وبال",
  "وال",
  "بال",
  "فال",
  "كال",
  "لل",
  "ال",
  "و",
  "ب",
  "ف",
  "ل"
 ],
 "SUFFIXES": [
  "اتهم",
  "ات",
  "ون",
  "ين",
  "ان",
  "ها",
  "هم",
  "ه",
  "ي"
 ],
 "TOPICS": [
  [
   "جزاء|خصم|تحقيق|مخالف|إنذار|انذار|فصل|عقوب|تأديب|وقف",
   [
    [
     "labor14",
     "138"
    ],
    [
     "labor14",
     "139"
    ],
    [
     "labor14",
     "140"
    ],
    [
     "labor14",
     "141"
    ],
    [
     "labor14",
     "142"
    ],
    [
     "labor14",
     "143"
    ],
    [
     "labor14",
     "144"
    ],
    [
     "labor14",
     "145"
    ],
    [
     "labor14",
     "148"
    ]
   ]
  ],
  [
   "إضافي|اضافي|أوفر|اوفر|ساعات العمل|راحة|ليلي",
   [
    [
     "labor14",
     "117"
    ],
    [
     "labor14",
     "118"
    ],
    [
     "labor14",
     "119"
    ],
    [
     "labor14",
     "120"
    ],
    [
     "labor14",
     "121"
    ],
    [
     "labor14",
     "123"
    ]
   ]
  ],
  [
   "إجاز|اجاز",
   [
    [
     "labor14",
     "124"
    ],
    [
     "labor14",
     "125"
    ],
    [
     "labor14",
     "126"
    ],
    [
     "labor14",
     "127"
    ],
    [
     "labor14",
     "128"
    ],
    [
     "labor14",
     "129"
    ],
    [
     "labor14",
     "130"
    ],
    [
     "labor14",
     "131"
    ]
   ]
  ],
  [
   "تأمين|تامين|اشتراك|معاش",
   [
    [
     "ins148",
     "1"
    ],
    [
     "ins148",
     "2"
    ],
    [
     "ins148",
     "19"
    ],
    [
     "ins148",
     "36"
    ],
    [
     "ins148",
     "46"
    ],
    [
     "ins148",
     "70"
    ],
    [
     "ins148",
     "86"
    ]
   ]
  ],
  [
   "عهد|تلف|فقد|اتلاف",
   [
    [
     "labor14",
     "151"
    ],
    [
     "labor14",
     "143"
    ]
   ]
  ],
  [
   "الذكاء|اصطناعي|المرور|حسابات|البريد|التواصل|تصوير|تسجيل",
   [
    [
     "penreg",
     "84"
    ],
    [
     "penreg",
     "86"
    ],
    [
     "penreg",
     "87"
    ],
    [
     "penreg",
     "88"
    ],
    [
     "penreg",
     "89"
    ],
    [
     "penreg",
     "90"
    ],
    [
     "penreg",
     "91"
    ]
   ]
  ],
  [
   "ديون|معدوم|ضريب",
   [
    [
     "tax151",
     "28/1/4"
    ],
    [
     "tax151",
     "43"
    ],
    [
     "tax151",
     "56 مكررا"
    ]
   ]
  ]
 ]
};


// ############################################################################
// ## Kb
// ############################################################################

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


// ############################################################################
// ## Penalties
// ############################################################################

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


// ############################################################################
// ## Calc
// ############################################################################

/**
 * الحاسبات القانونية. كل نتيجة تذكر المادة التي بُنيت عليها، والافتراضات غير المنصوص عليها تُعلن صراحة.
 */

function calcApi_(d) {
  var r;
  var num = function (k, def) { var v = parseFloat(d[k]); return isNaN(v) ? def : v; };
  if (d.type === 'overtime') r = calcOvertime_(num('wage'), num('day_hours', 0), num('night_hours', 0), num('rest_days', 0), num('divisor', 30), num('hours_per_day', 8), num('presence', 0));
  else if (d.type === 'deduction') r = calcDeduction_(num('wage'), num('divisor', 30), num('penalty_days', 0), num('already', 0), num('damage', 0));
  else if (d.type === 'insurance') r = calcInsurance_(num('wage'), parseInt(d.year, 10) || new Date().getFullYear());
  else if (d.type === 'tax') r = calcTax_(num('wage'));
  else throw userError_('حاسبة غير موجودة');
  r.sources = sourceShorts_();
  return r;
}

function requirePositive_(x) {
  if (!(x > 0)) throw userError_('أدخل الأجر بشكل صحيح');
}

function calcOvertime_(wage, dayH, nightH, restDays, divisor, hpd, presence) {
  requirePositive_(wage);
  var daily = wage / divisor, hourly = daily / hpd;
  var dayPay = dayH * hourly * 1.35, nightPay = nightH * hourly * 1.70, restPay = restDays * daily;
  var warnings = ['التشغيل الإضافي جائز لمواجهة ضرورات عمل غير عادية أو ظروف استثنائية، مع إبلاغ الجهة الإدارية خلال 7 أيام (مادة 121).'];
  if (presence > 12) warnings.unshift('لا يجوز أن تزيد ساعات وجود العامل بالمنشأة على 12 ساعة في جميع الأحوال (مادة 121).');
  return {
    summary: [{ label: 'الأجر اليومي', value: round2_(daily) }, { label: 'أجر الساعة', value: round2_(hourly) }],
    lines: [
      { label: 'ساعات إضافية نهارية: ' + dayH + ' ساعة × أجر الساعة × 135%', amount: round2_(dayPay) },
      { label: 'ساعات إضافية ليلية: ' + nightH + ' ساعة × أجر الساعة × 170%', amount: round2_(nightPay) },
      { label: 'العمل في يوم الراحة: ' + restDays + ' يوم × مثل الأجر اليومي (مع يوم راحة بديل خلال الأسبوع التالي)', amount: round2_(restPay) }
    ],
    total: { label: 'إجمالي الأجر الإضافي', amount: round2_(dayPay + nightPay + restPay) },
    assumptions: [
      'أجر الساعة = الأجر ÷ ' + divisor + ' يوماً ÷ ' + hpd + ' ساعات. القانون لا يحدد طريقة القسمة صراحة في المادة 121؛ عدّل القاسم إذا كانت لائحة الشركة أو العقد تنص على غير ذلك.',
      'النسب (35% نهاري، 70% ليلي) حد أدنى؛ يجوز الاتفاق في العقد على أكثر منها.',
      'الليل وفق قانون العمل: الفترة ما بين غروب الشمس وشروقها (مادة 1).'
    ],
    warnings: warnings,
    references: [['labor14', '121'], ['labor14', '117'], ['labor14', '119'], ['labor14', '1']].map(refObj_)
  };
}

function calcDeduction_(wage, divisor, penaltyDays, already, damage) {
  requirePositive_(wage);
  var daily = wage / divisor;
  var allowedPenalty = Math.min(penaltyDays, 5);
  var remaining = Math.max(0, 5 - already);
  var nowDays = Math.min(allowedPenalty, remaining);
  var lines = [
    { label: 'الأجر الأساسي اليومي', amount: round2_(daily) },
    { label: 'جزاء الخصم المطلوب: ' + penaltyDays + ' يوم (الحد الأقصى للمخالفة الواحدة 5 أيام)', amount: round2_(allowedPenalty * daily) },
    { label: 'المسموح اقتطاعه هذا الشهر بعد خصم سابق ' + already + ' يوم (الحد 5 أيام شهرياً)', amount: round2_(nowDays * daily) }
  ];
  var warnings = [];
  if (penaltyDays > 5) warnings.push('لا يجوز توقيع جزاء خصم يزيد على 5 أيام من الأجر الأساسي عن المخالفة الواحدة (مادة 143).');
  if (allowedPenalty > remaining) warnings.push('الاقتطاع للجزاءات لا يزيد على أجر 5 أيام في الشهر الواحد؛ الباقي يُرحّل للشهر التالي (مادة 143).');
  if (damage > 0) {
    var monthlyCap = 5 * daily, totalCap = 2 * wage;
    lines.push({ label: 'قيمة التلف أو الفقد المطلوب استيفاؤها', amount: round2_(damage) });
    lines.push({ label: 'الحد الأقصى للاقتطاع الشهري للتلف (أجر 5 أيام)', amount: round2_(monthlyCap) });
    lines.push({ label: 'الحد الأقصى الذي يجوز استيفاؤه بالاقتطاع إجمالاً (أجر شهرين)', amount: round2_(totalCap) });
    lines.push({ label: 'المبلغ الذي يجوز استيفاؤه بالاقتطاع', amount: round2_(Math.min(damage, totalCap)) });
    lines.push({ label: 'عدد الأشهر التقريبي للسداد بالاقتطاع', amount: Math.round(Math.min(damage, totalCap) / monthlyCap * 10) / 10, plain: true });
    if (damage > totalCap) warnings.push('ما يزيد على أجر شهرين لا يجوز استيفاؤه بالاقتطاع من الأجر، ويُطالب به بالطريق القانوني (مادة 151).');
    warnings.push('لا يبدأ الاقتطاع للتلف إلا بعد إجراء التحقيق وإخطار العامل، وله التظلم أمام المحكمة العمالية (مادة 151).');
  }
  return {
    lines: lines, warnings: warnings,
    assumptions: ['الأجر اليومي = الأجر الأساسي الشهري ÷ ' + divisor + '. الخصم بنسبة يُحسب على الأجر الأساسي اليومي (مادة 143).'],
    references: [['labor14', '143'], ['labor14', '140'], ['labor14', '151']].map(refObj_)
  };
}

var INSURANCE_RATES = [
  ['تأمين الشيخوخة والعجز والوفاة', 12, 9, '19'],
  ['إصابات العمل - العلاج والرعاية الطبية (لغير الخاضعين للتأمين الصحي الشامل)', 1, 0, '46'],
  ['إصابات العمل - الحقوق المالية (قد تزيد حتى 1% حسب مخاطر النشاط)', 0.5, 0, '46'],
  ['تأمين المرض (القطاع الخاص)', 3.25, 1, '70'],
  ['تأمين البطالة', 1, 0, '86'],
  ['نظام المكافأة', 1, 1, '36']
];

function calcInsurance_(wage, year) {
  requirePositive_(wage);
  var limits = getSetting_('insurance_limits', {}) || {};
  var lim = limits[String(year)];
  var warnings = [], w = wage;
  if (lim) {
    if (w < lim.min) { w = lim.min; warnings.push('الأجر أقل من الحد الأدنى لأجر الاشتراك لسنة ' + year + ' (' + lim.min + ')؛ يُحسب الاشتراك على الحد الأدنى.'); }
    else if (w > lim.max) { w = lim.max; warnings.push('الأجر أكبر من الحد الأقصى لأجر الاشتراك لسنة ' + year + ' (' + lim.max + ')؛ يُحسب الاشتراك على الحد الأقصى.'); }
  } else {
    warnings.push('لم يتم إدخال الحدين الأدنى والأقصى لأجر الاشتراك لسنة ' + year + ' (يحددهما قرار سنوي وليس القانون). أدخلهما من صفحة الإدارة لضبط الحساب.');
  }
  var er = 0, ee = 0, erRate = 0, eeRate = 0;
  var rows = INSURANCE_RATES.map(function (r) {
    var a = w * r[1] / 100, b = w * r[2] / 100;
    er += a; ee += b; erRate += r[1]; eeRate += r[2];
    return { label: r[0], employer_rate: r[1], employee_rate: r[2], employer: round2_(a), employee: round2_(b), article: r[3] };
  });
  return {
    table: rows, insured_wage: round2_(w),
    totals: { employer: round2_(er), employee: round2_(ee), employer_rate: erRate, employee_rate: eeRate },
    warnings: warnings,
    assumptions: [
      'النسب من نص القانون 148 لسنة 2019 كما صدر. تزاد نسبة اشتراكات الشيخوخة 1% كل سبع سنوات من تاريخ العمل بالقانون وتقسم مناصفة بين صاحب العمل والعامل (مادة 19)؛ راجع ما إذا كانت الزيادة قد استحقت.',
      'نسب تأمين الإصابة والمرض قد تختلف للمنشآت الخاضعة لقانون التأمين الصحي الشامل (المادتان 46 و 70).',
      'عناصر أجر الاشتراك في المادة 1 (بند 8)، والحدود في اللائحة التنفيذية والقرارات السنوية (غير متاحة في المراجع).'
    ],
    references: ['19', '46', '70', '86', '36', '1'].map(function (n) { return { source: 'ins148', article: n }; })
  };
}

function calcTax_(monthly) {
  requirePositive_(monthly);
  var cfg = getSetting_('payroll_tax', null);
  if (!cfg || !cfg.brackets || !cfg.brackets.length) {
    return { error: 'شرائح ضريبة المرتبات غير مُدخلة. المادة 8 من قانون الضريبة على الدخل ليست ضمن المراجع المرفوعة، لذلك يجب على مدير النظام إدخال الشرائح السارية ومصدرها من صفحة الإدارة.' };
  }
  var annual = monthly * 12, exemption = parseFloat(cfg.personal_exemption || 0) || 0;
  var taxable = Math.max(0, annual - exemption), lower = 0, tax = 0, lines = [];
  for (var i = 0; i < cfg.brackets.length; i++) {
    var b = cfg.brackets[i], upper = (b.up_to === null || b.up_to === '') ? Infinity : Number(b.up_to);
    var portion = Math.max(0, Math.min(taxable, upper) - lower);
    if (portion > 0) {
      var t = portion * Number(b.rate) / 100;
      tax += t;
      lines.push({ label: 'من ' + lower + ' إلى ' + (upper === Infinity ? '∞' : upper) + ' بسعر ' + b.rate + '%', amount: round2_(t) });
    }
    lower = upper;
    if (taxable <= upper) break;
  }
  return {
    summary: [{ label: 'الدخل السنوي', value: round2_(annual) }, { label: 'الإعفاء', value: exemption }, { label: 'الخاضع للضريبة', value: round2_(taxable) }],
    lines: lines,
    total: { label: 'الضريبة الشهرية (السنوية ' + round2_(tax) + ')', amount: round2_(tax / 12) },
    warnings: ['الشرائح مُدخلة يدوياً من مدير النظام (المصدر: ' + (cfg.source || 'غير محدد') + ') وليست من المراجع القانونية المرفوعة؛ تأكد من مطابقتها للقانون الساري.'],
    assumptions: [], references: []
  };
}

function refObj_(r) { return { source: r[0], article: r[1] }; }


// ############################################################################
// ## Docs
// ############################################################################

/**
 * مولّد المستندات: ينشئ مستند Google Docs عربي (من اليمين لليسار) + نسخة PDF في مجلد على Drive.
 * المستندات: إخطار بالتحقيق، محضر تحقيق، قرار جزاء، إنذار كتابي — مع السند من قانون العمل.
 */

var DOC_TYPES = {
  notice: 'إخطار بالإحالة للتحقيق',
  minutes: 'محضر تحقيق',
  decision: 'قرار توقيع جزاء',
  warning: 'إنذار كتابي'
};

var DOC_FIELDS = [
  ['employee_name', 'اسم العامل', 'text', 'notice minutes decision warning'],
  ['employee_code', 'الرقم الوظيفي', 'text', 'notice minutes decision warning'],
  ['job_title', 'الوظيفة', 'text', 'notice minutes decision warning'],
  ['department', 'الإدارة / القسم', 'text', 'notice minutes decision warning'],
  ['violation_num', 'المخالفة في لائحة الجزاءات', 'violation', 'notice minutes decision warning'],
  ['violation_desc', 'وصف الواقعة المنسوبة للعامل', 'textarea', 'notice minutes decision warning'],
  ['violation_date', 'تاريخ الواقعة', 'date', 'notice minutes decision warning'],
  ['discovered_date', 'تاريخ اكتشاف المخالفة', 'date', 'notice minutes decision'],
  ['investigation_date', 'تاريخ ووقت التحقيق', 'datetime-local', 'notice minutes decision'],
  ['investigation_place', 'مكان التحقيق', 'text', 'notice minutes'],
  ['investigator_name', 'اسم المحقق', 'text', 'notice minutes decision'],
  ['investigator_title', 'وظيفة المحقق', 'text', 'notice minutes decision'],
  ['employee_statement', 'أقوال العامل ودفاعه', 'textarea', 'minutes'],
  ['witnesses', 'أقوال الشهود (إن وجدت)', 'textarea', 'minutes'],
  ['findings', 'ما انتهى إليه التحقيق', 'textarea', 'minutes decision'],
  ['occurrence', 'مرة التكرار (أول / ثاني / ثالث / رابع)', 'text', 'decision warning'],
  ['penalty_text', 'الجزاء الموقع', 'text', 'decision'],
  ['deduction_amount', 'قيمة الخصم بالجنيه (إن وجد)', 'number', 'decision'],
  ['signer_name', 'اسم صاحب سلطة التوقيع', 'text', 'notice decision warning'],
  ['signer_title', 'صفته (صاحب العمل / مدير المنشأة / مفوض)', 'text', 'notice decision warning'],
  ['doc_date', 'تاريخ المستند', 'date', 'notice minutes decision warning']
];

function docsFields_() {
  return { types: DOC_TYPES, fields: DOC_FIELDS.map(function (f) { return { key: f[0], label: f[1], type: f[2], docs: f[3].split(' ') }; }) };
}

function docsFolder_() {
  var id = getSetting_('docs_folder_id', null);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* أُعيد إنشاؤه */ } }
  var folder = DriveApp.createFolder('المستشار القانوني - المستندات');
  setSetting_('docs_folder_id', folder.getId());
  return folder;
}

function docsGenerate_(d, user) {
  var type = d.doc_type;
  if (!DOC_TYPES[type]) throw userError_('نوع مستند غير معروف');
  var f = d.fields || {};
  var v = f.violation_num ? getViolation_(f.violation_num) : null;
  var company = getSetting_('company_name', 'Full Speed');
  var title = DOC_TYPES[type] + ' - ' + (f.employee_name || 'عامل') + ' - ' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.setMarginTop(50).setMarginBottom(50).setMarginLeft(60).setMarginRight(60);

  function p(text, opt) {
    opt = opt || {};
    var para = body.appendParagraph(text || '');
    para.setLeftToRight(false);
    para.setAlignment(opt.center ? DocumentApp.HorizontalAlignment.CENTER : DocumentApp.HorizontalAlignment.RIGHT);
    var t = para.editAsText();
    t.setFontFamily('Arial').setFontSize(opt.size || 13).setBold(!!opt.bold);
    if (opt.color) t.setForegroundColor(opt.color);
    para.setSpacingAfter(opt.after === undefined ? 6 : opt.after);
    return para;
  }
  function labeled(label, value) {
    var para = p(label + ': ' + (value || '........................................'));
    para.editAsText().setBold(0, label.length, true);
  }
  function table(rows) {
    var t = body.appendTable(rows.map(function (r) { return [r[0], r[1] || '']; }));
    for (var i = 0; i < t.getNumRows(); i++) {
      for (var j = 0; j < 2; j++) {
        var cell = t.getCell(i, j), para = cell.getChild(0).asParagraph();
        para.setLeftToRight(false).setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
        para.editAsText().setFontFamily('Arial').setFontSize(12).setBold(j === 0);
      }
    }
    p('', { after: 2 });
  }
  function signatures(labels) {
    p('', { after: 14 });
    var t = body.appendTable([labels, labels.map(function () { return '\n.............................'; })]);
    t.setBorderWidth(0);
    for (var i = 0; i < 2; i++) for (var j = 0; j < labels.length; j++) {
      var para = t.getCell(i, j).getChild(0).asParagraph();
      para.setLeftToRight(false).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      para.editAsText().setFontFamily('Arial').setFontSize(12).setBold(i === 0);
    }
  }
  var dt = function (s) { return s ? String(s).replace('T', ' الساعة ') : ''; };
  var dots = '..........';

  body.getChild(0).asParagraph().setText('');
  p(company, { center: true, bold: true, size: 17, after: 2 });
  p('إدارة الموارد البشرية والشؤون القانونية', { center: true, size: 12, after: 10, color: '#555555' });
  p(DOC_TYPES[type], { center: true, bold: true, size: 19, after: 12 });
  p('التاريخ: ' + (f.doc_date || Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd')), { size: 12 });

  var emp = [['اسم العامل', f.employee_name], ['الرقم الوظيفي', f.employee_code], ['الوظيفة', f.job_title], ['الإدارة / القسم', f.department]];
  var vref = v ? 'المخالفة رقم (' + v.num + ') من لائحة الجزاءات: ' + v.text.replace(/\.$/, '') : '';
  var legal = function (txt) { p(txt, { size: 11, color: '#555555' }); };

  if (type === 'notice') {
    table(emp);
    p('نحيطكم علماً بأنه قد نُسب إليكم ما يلي:', { bold: true });
    p(f.violation_desc || '........................................');
    if (vref) p(vref, { size: 12 });
    labeled('تاريخ الواقعة', f.violation_date);
    p('وعليه، يتعين عليكم الحضور للتحقيق وسماع أقوالكم وتحقيق دفاعكم وفقاً للآتي:', { bold: true });
    table([['موعد التحقيق', dt(f.investigation_date)], ['مكان التحقيق', f.investigation_place],
           ['المحقق', (f.investigator_name || '') + ' - ' + (f.investigator_title || '')]]);
    p('ولكم أن تقدموا ما لديكم من مستندات أو أوجه دفاع، وللمنظمة النقابية التي تتبعونها أن تندب ممثلاً عنها لحضور التحقيق. وفي حالة عدم الحضور دون عذر مقبول يُستكمل التحقيق وفقاً للمستندات المتاحة.');
    legal('السند القانوني: المادتان (141) و(142) من قانون العمل الصادر بالقانون رقم 14 لسنة 2025.');
    signatures(['توقيع العامل بالاستلام', 'صاحب سلطة الإحالة']);
  } else if (type === 'minutes') {
    p('إنه في يوم ' + (dt(f.investigation_date) || dots) + ' وبمقر ' + (f.investigation_place || dots) + '، قمنا نحن ' +
      (f.investigator_name || dots) + ' (' + (f.investigator_title || dots) + ') بفتح هذا المحضر للتحقيق مع العامل الآتي بياناته:');
    table(emp);
    p('موضوع التحقيق:', { bold: true });
    p(f.violation_desc || '........................................');
    if (vref) p(vref, { size: 12 });
    table([['تاريخ الواقعة', f.violation_date], ['تاريخ اكتشاف المخالفة', f.discovered_date]]);
    p('تم إبلاغ العامل كتابة بما نُسب إليه، وبمواجهته أجاب:', { bold: true });
    p(f.employee_statement || 'س: ............................................\nج: ............................................');
    p('أقوال الشهود:', { bold: true });
    p(f.witnesses || 'لا يوجد');
    p('ما انتهى إليه التحقيق:', { bold: true });
    p(f.findings || '........................................');
    p('وأُقفل المحضر في حينه، ويودع في ملف العامل الخاص.');
    legal('السند القانوني: المادتان (141) و(142) من قانون العمل الصادر بالقانون رقم 14 لسنة 2025.');
    signatures(['توقيع العامل', 'توقيع المحقق']);
  } else if (type === 'decision') {
    p('إن ' + (f.signer_title || 'صاحب العمل') + '،', { bold: true });
    p('بعد الاطلاع على قانون العمل الصادر بالقانون رقم 14 لسنة 2025، وعلى الأخص المواد (138) و(139) و(140) و(141) و(143) و(148)؛');
    p('وعلى لائحة تنظيم العمل والجزاءات بالمنشأة؛');
    p('وعلى محضر التحقيق المؤرخ ' + (dt(f.investigation_date) || dots) + ' الذي أجراه ' + (f.investigator_name || dots) + '؛');
    p('وحيث نُسب إلى العامل ' + (f.employee_name || dots) + ' (' + (f.job_title || dots) + ') أنه: ' + (f.violation_desc || dots) + '؛');
    if (vref) p('وحيث إن هذه الواقعة تشكل ' + vref + '؛');
    p('وحيث ثبت من التحقيق: ' + (f.findings || dots) + '؛');
    if (f.occurrence) p('وحيث إن هذه هي المرة (' + f.occurrence + ') لارتكاب هذه المخالفة خلال سنة من تاريخ إبلاغه بالجزاء السابق؛');
    p('قرر', { center: true, bold: true, size: 16 });
    p('مادة أولى: مجازاة العامل المذكور بـ: ' + (f.penalty_text || dots) + (f.deduction_amount ? ' (بقيمة ' + f.deduction_amount + ' جنيه من الأجر الأساسي)' : '') + '.');
    p('مادة ثانية: يُبلغ العامل بهذا القرار كتابة، ويودع في ملفه الخاص، ويقيد الجزاء المالي في سجل الجزاءات (مادة 153).');
    p('مادة ثالثة: على الإدارات المختصة تنفيذ هذا القرار.');
    legal('ملاحظات قانونية: لا يجوز توقيع الجزاء بعد مضي 30 يوماً من انتهاء التحقيق (مادة 138)، ولا يزيد الخصم على 5 أيام للمخالفة الواحدة ولا على أجر 5 أيام في الشهر (مادة 143)، ولمدير المنشأة توقيع الإنذار والخصم حتى 3 أيام فقط، والفصل للمحكمة العمالية (مادة 148).');
    signatures(['توقيع العامل بالاستلام', f.signer_name || 'صاحب سلطة التوقيع']);
  } else if (type === 'warning') {
    table(emp);
    p('نوجه إليكم هذا الإنذار الكتابي بسبب ما يلي:', { bold: true });
    p(f.violation_desc || '........................................');
    if (vref) p(vref, { size: 12 });
    labeled('تاريخ الواقعة', f.violation_date);
    p('وننبه عليكم بضرورة الالتزام بأحكام لائحة تنظيم العمل والتعليمات، وفي حالة تكرار المخالفة خلال سنة من تاريخ إبلاغكم بهذا الإنذار يجوز تشديد الجزاء وفقاً للمادة (144) من قانون العمل.');
    legal('السند القانوني: المواد (139/1) و(141) و(148) من قانون العمل الصادر بالقانون رقم 14 لسنة 2025. يجوز أن يكون التحقيق في المخالفات المعاقب عليها بالإنذار شفاهة على أن يثبت مضمونه في القرار (مادة 141).');
    signatures(['توقيع العامل بالاستلام', f.signer_name || 'صاحب سلطة التوقيع']);
  }

  doc.saveAndClose();
  var folder = docsFolder_();
  var file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  var pdf = folder.createFile(file.getAs('application/pdf')).setName(title + '.pdf');
  appendRow_('Documents', { time: new Date(), username: user.username, doc_type: DOC_TYPES[type], employee: f.employee_name || '',
                            doc_url: doc.getUrl(), pdf_url: pdf.getUrl() });
  return { title: title, docUrl: doc.getUrl(), pdfUrl: pdf.getUrl() };
}

function docsRecent_() {
  return readRows_('Documents').slice(-15).reverse().map(function (r) {
    return { time: Utilities.formatDate(new Date(r.time), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'), username: r.username,
             doc_type: r.doc_type, employee: r.employee, doc_url: r.doc_url, pdf_url: r.pdf_url };
  });
}


// ############################################################################
// ## Ai
// ############################################################################

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


// ############################################################################
// ## Manage
// ############################################################################

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
