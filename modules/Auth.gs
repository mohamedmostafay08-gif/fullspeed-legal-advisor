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
