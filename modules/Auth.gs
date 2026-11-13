/**
 * الحسابات والدخول.
 * - المستخدمون يُنشئهم مدير النظام فقط (إيميل + كلمة مرور)، بحد أقصى 5 حسابات.
 * - الدخول بالإيميل وكلمة المرور، أو بزر "الدخول بحساب Google" (للإيميلات المسجلة فقط).
 * - "نسيت كلمة المرور": كود من 6 أرقام يُرسل للإيميل صالح 15 دقيقة.
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

/** يبحث بالإيميل أولاً ثم باسم المستخدم (للحسابات القديمة). */
function findLogin_(id) {
  id = String(id || '').trim().toLowerCase();
  if (!id) return null;
  var rows = readRows_('Users');
  for (var i = 0; i < rows.length; i++) if (String(rows[i].email || '').toLowerCase() === id) return rows[i];
  return id.indexOf('@') < 0 ? findUser_(id) : null;
}

function isActive_(u) { return u.active === true || u.active === 'TRUE'; }

function validateEmail_(e) {
  e = String(e || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) || e.length > 120) throw userError_('اكتب إيميل صحيح');
  return e;
}

function emailTaken_(email, exceptUsername) {
  return readRows_('Users').some(function (r) { return String(r.email || '').toLowerCase() === email && r.username !== exceptUsername; });
}

/** اسم مستخدم داخلي فريد من الإيميل (يُستخدم في السجلات فقط). */
function usernameFromEmail_(email) {
  var base = email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user';
  if (base.length < 3) base = base + 'usr';
  var name = base, n = 2;
  while (findUser_(name)) name = base + n++;
  return name;
}

function publicUser_(u) {
  return { username: u.username, email: String(u.email || ''), full_name: u.full_name, role: u.role, active: isActive_(u),
           created_at: u.created_at ? String(u.created_at) : '', last_login: u.last_login ? String(u.last_login) : '' };
}

function startSession_(u) {
  var token = newToken_();
  CacheService.getScriptCache().put('sess_' + token, u.username, SESSION_SECONDS);
  updateRow_('Users', u._row, { last_login: new Date() });
  return { token: token, user: publicUser_(u) };
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
  if (!u || !isActive_(u)) return null;
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
  return { hasUsers: readRows_('Users').length > 0, hasData: hasData_(), company: getSetting_('company_name', 'Full Speed'),
           googleClientId: getSetting_('google_client_id', '') || '' };
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
    var email = validateEmail_(d.email);
    validatePassword_(d.password);
    if (!d.fullName || String(d.fullName).trim().length < 2) throw userError_('اكتب الاسم الكامل');
    var imported = null;
    if (d.dataParts) imported = importData_(assembleUpload_('setup_up_', parseInt(d.dataParts, 10)));
    else if (!hasData_()) throw userError_('اختر ملف البيانات FullSpeed_Legal_Data.json');
    var salt = newSalt_();
    appendRow_('Users', { username: usernameFromEmail_(email), email: email, full_name: d.fullName.trim(), role: 'admin',
                          salt: salt, hash: hashPassword_(d.password, salt), active: true, created_at: new Date() });
    PropertiesService.getScriptProperties().deleteProperty('SETUP_CODE');
    return { done: true, imported: imported };
  } finally {
    lock.releaseLock();
  }
}

function authLogin_(d) {
  var id = String(d.email || d.username || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + id;
  var fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= 5) throw userError_('تم إيقاف الدخول لهذا الحساب 15 دقيقة بسبب محاولات خاطئة متكررة');
  var u = findLogin_(id);
  var ok = u && isActive_(u) && safeEqual_(hashPassword_(String(d.password || ''), u.salt), u.hash);
  if (!ok) {
    cache.put(failKey, String(fails + 1), 900);
    Utilities.sleep(600);
    throw userError_('الإيميل أو كلمة المرور غير صحيحة');
  }
  cache.remove(failKey);
  return startSession_(u);
}

/** الدخول بحساب Google: يتحقق من الرمز عند Google نفسها، ثم يطابق الإيميل مع حساب موجود. */
function authGoogle_(d) {
  var clientId = getSetting_('google_client_id', '');
  if (!clientId) throw userError_('الدخول بحساب Google غير مفعّل');
  var cred = String(d.credential || '');
  if (!/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(cred)) throw userError_('بيانات الدخول من Google غير صالحة');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw userError_('تعذر التحقق من حساب Google، حاول مرة أخرى');
  var info = JSON.parse(res.getContentText());
  var issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  var verified = info.email_verified === true || info.email_verified === 'true';
  if (info.aud !== clientId || !issOk || !verified || Number(info.exp) * 1000 < Date.now()) throw userError_('تعذر التحقق من حساب Google');
  var u = findLogin_(String(info.email || '').toLowerCase());
  if (!u || String(u.email || '').toLowerCase() !== String(info.email).toLowerCase()) throw userError_('هذا الإيميل غير مسجل في البرنامج. اطلب من مدير النظام إضافته.');
  if (!isActive_(u)) throw userError_('هذا الحساب موقوف');
  return startSession_(u);
}

/** نسيت كلمة المرور: يرسل كوداً للإيميل (الرد واحد دائماً حتى لا يكشف الإيميلات المسجلة). */
function authForgot_(d) {
  var email = validateEmail_(d.email);
  var cache = CacheService.getScriptCache();
  if (cache.get('rsent_' + email)) return { sent: true }; // كود واحد كل دقيقتين
  var u = findLogin_(email);
  if (u && isActive_(u) && String(u.email || '').toLowerCase() === email) {
    var code = String(100000 + Math.floor(Math.random() * 900000));
    var salt = newSalt_();
    cache.put('reset_' + email, JSON.stringify({ salt: salt, hash: hashPassword_(code, salt), tries: 0 }), 900);
    cache.put('rsent_' + email, '1', 120);
    MailApp.sendEmail({
      to: email,
      subject: 'كود استعادة كلمة المرور — المستشار القانوني',
      htmlBody: '<div dir="rtl" style="font-family:Tahoma,Arial;font-size:15px">مرحباً ' + escHtml_(u.full_name) + '،<br><br>' +
        'كود استعادة كلمة المرور:<div style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:12px 0">' + code + '</div>' +
        'صالح لمدة 15 دقيقة. إذا لم تطلب ذلك تجاهل هذه الرسالة.<br><br>' + escHtml_(getSetting_('company_name', 'Full Speed')) + ' · المستشار القانوني</div>',
      name: 'المستشار القانوني'
    });
  }
  return { sent: true };
}

function authReset_(d) {
  var email = validateEmail_(d.email);
  var cache = CacheService.getScriptCache();
  var raw = cache.get('reset_' + email);
  if (!raw) throw userError_('الكود غير صحيح أو انتهت صلاحيته. اطلب كوداً جديداً.');
  var r = JSON.parse(raw);
  if (r.tries >= 5) { cache.remove('reset_' + email); throw userError_('محاولات كثيرة. اطلب كوداً جديداً.'); }
  if (!safeEqual_(hashPassword_(String(d.code || '').trim(), r.salt), r.hash)) {
    r.tries++; cache.put('reset_' + email, JSON.stringify(r), 900);
    throw userError_('الكود غير صحيح');
  }
  validatePassword_(d.password);
  var u = findLogin_(email);
  if (!u) throw userError_('الحساب غير موجود');
  var salt = newSalt_();
  updateRow_('Users', u._row, { salt: salt, hash: hashPassword_(d.password, salt) });
  cache.remove('reset_' + email);
  cache.remove('fail_' + email);
  return startSession_(findLogin_(email));
}

/** ربط أو تغيير إيميل الحساب (للحسابات القديمة التي أُنشئت باسم مستخدم). */
function authSetEmail_(d, user) {
  var email = validateEmail_(d.email);
  if (emailTaken_(email, user.username)) throw userError_('هذا الإيميل مستخدم لحساب آخر');
  var u = findUser_(user.username);
  updateRow_('Users', u._row, { email: email });
  return { email: email };
}

function escHtml_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * شغّل هذه الدالة مرة واحدة من محرر Apps Script بعد التحديث (زر Run) لمنح صلاحية إرسال الإيميلات
 * (لكود "نسيت كلمة المرور") والاتصال بخدمات Google للتحقق من الدخول.
 */
function authorizeEmail() {
  console.log('الإيميلات المتبقية اليوم: ' + MailApp.getRemainingDailyQuota());
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', { muteHttpExceptions: true });
  console.log('تم منح الصلاحيات بنجاح');
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
    var email = validateEmail_(d.email);
    validatePassword_(d.password);
    if (emailTaken_(email)) throw userError_('هذا الإيميل مسجل بالفعل');
    if (!d.fullName || String(d.fullName).trim().length < 2) throw userError_('اكتب الاسم الكامل');
    var salt = newSalt_();
    appendRow_('Users', { username: usernameFromEmail_(email), email: email, full_name: String(d.fullName).trim(),
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

function adminUserEmail_(d) {
  var u = findUser_(d.username);
  if (!u) throw userError_('المستخدم غير موجود');
  var email = validateEmail_(d.email);
  if (emailTaken_(email, u.username)) throw userError_('هذا الإيميل مستخدم لحساب آخر');
  updateRow_('Users', u._row, { email: email });
  return { done: true };
}

function adminUserDelete_(d, admin) {
  var u = findUser_(d.username);
  if (!u) throw userError_('المستخدم غير موجود');
  if (u.username === admin.username) throw userError_('لا يمكنك حذف حسابك');
  sheet_('Users').deleteRow(u._row);
  return { done: true };
}
