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
  'auth.google':        [authGoogle_, 'public'],
  'auth.forgot':        [authForgot_, 'public'],
  'auth.reset':         [authReset_, 'public'],
  'auth.setEmail':      [authSetEmail_, 'user'],
  // الرئيسية والمفضلة وإيه الجديد
  'dash':               [dashboard_, 'user'],
  'fav.toggle':         [favToggle_, 'user'],
  'fav.list':           [favList_, 'user'],
  'news':               [newsList_, 'user'],
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
  'admin.userEmail':    [adminUserEmail_, 'admin'],
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
