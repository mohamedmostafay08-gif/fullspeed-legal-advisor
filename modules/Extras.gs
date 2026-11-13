/**
 * إضافات الاستخدام اليومي: الصفحة الرئيسية، المفضلة، و"إيه الجديد" (سجل تعديلات القوانين).
 */

// ---------------- إيه الجديد ----------------

/** يسجل تعديلاً على القوانين ليظهر للمستخدمين في "إيه الجديد" (آخر 40 تعديل). */
function newsLog_(by, text, ref) {
  try {
    var list = getSetting_('changelog', []) || [];
    list.unshift({ t: new Date().toISOString(), by: String(by || ''), text: String(text).slice(0, 200), ref: ref || null });
    setSetting_('changelog', list.slice(0, 40));
  } catch (e) { console.warn('newsLog failed: ' + e); }
}

function newsList_() {
  return { items: (getSetting_('changelog', []) || []).slice(0, 20) };
}

// ---------------- المفضلة ----------------

function favKeys_(u) {
  try { var a = JSON.parse(u.favorites || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function favToggle_(d, user) {
  var a = getArticle_(d.source, d.num);
  if (!a) throw userError_('المادة غير موجودة');
  var key = a.source + '|' + a.num;
  var u = findUser_(user.username);
  var keys = favKeys_(u), i = keys.indexOf(key), on = i < 0;
  if (on) keys.unshift(key); else keys.splice(i, 1);
  if (keys.length > 150) throw userError_('وصلت للحد الأقصى للمفضلة (150 مادة)');
  updateRow_('Users', u._row, { favorites: JSON.stringify(keys) });
  return { on: on, keys: keys };
}

function favList_(d, user) {
  var keys = favKeys_(findUser_(user.username)), shorts = sourceShorts_();
  return { keys: keys, items: keys.map(function (k) {
    var p = k.split('|'), a = getArticle_(p[0], p[1]);
    return a ? { source: a.source, num: a.num, label: a.label, short: shorts[a.source], snippet: a.text.slice(0, 180) } : null;
  }).filter(Boolean) };
}

// ---------------- الصفحة الرئيسية ----------------

function dashboard_(d, user) {
  var qs = readRows_('Questions');
  var month = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM');
  var mine = qs.filter(function (r) { return r.username === user.username; });
  var inMonth = function (r) { return Utilities.formatDate(new Date(r.time), 'Africa/Cairo', 'yyyy-MM') === month; };
  var sources = kbSources_();
  var total = 0;
  sources.forEach(function (s) { total += s.count; });
  return {
    stats: {
      articles: total, sources: sources.length, violations: violations_().length,
      myMonth: mine.filter(inMonth).length, myTotal: mine.length,
      teamMonth: user.role === 'admin' ? qs.filter(inMonth).length : null
    },
    recent: mine.slice(-5).reverse().map(function (r) {
      return { id: String(r.id), question: String(r.question).slice(0, 140), time: Utilities.formatDate(new Date(r.time), 'Africa/Cairo', 'yyyy-MM-dd HH:mm') };
    }),
    sources: sources.map(function (s) { return { id: s.id, short: s.short, count: s.count }; }),
    news: (getSetting_('changelog', []) || []).slice(0, 6),
    favorites: favKeys_(findUser_(user.username)).length,
    ai: !!aiKey_()
  };
}
