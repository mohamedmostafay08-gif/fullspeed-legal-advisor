/** اختبارات الخادم (منطق Apps Script) عبر بيئة المحاكاة. */
const assert = require('assert');
process.argv[2] = process.argv[2] || process.env.DATA_FILE || __dirname + '/../data/FullSpeed_Legal_Data.json';
const H = require('./harness');
const { ctx, callApi, sheets, geminiCalls, createdDocs, sentMails } = H;

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('✓ ' + name); } catch (e) { console.log('✗ ' + name + '\n   ' + e.message); process.exitCode = 1; }
}
const call = (action, data, token) => callApi({ action, data, token });
const ok = (r, msg) => { if (!r.ok) throw new Error((msg || '') + ' → ' + r.error); return r.data; };
const fail = (r, re) => { if (r.ok) throw new Error('expected failure'); if (re && !re.test(r.error)) throw new Error('wrong error: ' + r.error); };

let admin, user;

t('status before setup', () => { const s = ok(call('auth.status')); assert.strictEqual(s.hasUsers, false); });
t('setup requires code', () => { fail(call('auth.setup', { setupCode: 'X', fullName: 'مدير', email: 'admin@fs.com', password: 'Admin12345' }), /كود الإعداد/); });
t('setup with code', () => {
  const code = ctx.createSetupCode();
  ok(call('auth.setup', { setupCode: code, fullName: 'مدير النظام', email: 'Admin@FS.com', password: 'Admin12345' }));
  fail(call('auth.setup', { setupCode: code, fullName: 'x', email: 'x2@fs.com', password: 'Admin12345' }), /بالفعل/);
});
t('password stored hashed', () => { const row = sheets.Users.data[1]; assert.ok(!row.join('|').includes('Admin12345')); assert.ok(row[4].length > 20); });
t('login wrong password', () => { fail(call('auth.login', { username: 'admin', password: 'nope1234' }), /غير صحيحة/); });
t('login ok (case-insensitive email)', () => { admin = ok(call('auth.login', { email: 'ADMIN@fs.com', password: 'Admin12345' })).token; assert.ok(/^[a-f0-9]{48}$/.test(admin)); });
t('protected route without token', () => { const r = call('kb.sources', {}, 'bad'); assert.strictEqual(r.auth, false); });
t('create users up to 5', () => {
  for (let i = 1; i <= 4; i++) ok(call('admin.userCreate', { fullName: 'مستخدم ' + i, email: 'user' + i + '@fs.com', password: 'Pass1234' + i, role: 'user' }, admin), 'create ' + i);
  fail(call('admin.userCreate', { fullName: 'زائد', email: 'user5@fs.com', password: 'Pass12345', role: 'user' }, admin), /الحد الأقصى/);
});
t('weak password rejected', () => {
  ok(call('admin.userDelete', { username: 'user4' }, admin));
  fail(call('admin.userCreate', { fullName: 'ضعيف', email: 'weak@fs.com', password: 'abcdefgh' }, admin), /أرقام وحروف/);
});
t('user login + admin route forbidden', () => {
  user = ok(call('auth.login', { username: 'user1', password: 'Pass12341' })).token;
  fail(call('admin.overview', {}, user), /لمدير النظام/);
});
t('lockout after 5 failures', () => {
  for (let i = 0; i < 5; i++) call('auth.login', { username: 'user2', password: 'wrong' + i });
  fail(call('auth.login', { username: 'user2', password: 'Pass12342' }), /إيقاف الدخول/);
});
t('deactivated user session dies', () => {
  const tok = ok(call('auth.login', { username: 'user3', password: 'Pass12343' })).token;
  ok(call('admin.userToggle', { username: 'user3' }, admin));
  assert.strictEqual(call('kb.sources', {}, tok).auth, false);
  ok(call('admin.userToggle', { username: 'user3' }, admin));
});
t('kb sources & counts', () => {
  const s = ok(call('kb.sources', {}, user));
  const c = Object.fromEntries(s.map(x => [x.id, x.count]));
  assert.deepStrictEqual(c, { labor14: 311, workreg: 112, penreg: 86, ins148: 176, tax151: 18 });
});
t('kb cache chunks under 100KB', () => { for (const [k, v] of H.cacheStore) assert.ok(v.length <= 100000, k); });
t('article lookup incl. merged + slash nums', () => {
  assert.strictEqual(ok(call('kb.article', { source: 'labor14', num: '141' }, user)).label, 'مادة 141');
  assert.match(ok(call('kb.article', { source: 'workreg', num: '3' }, user)).label, /وتشمل نص المادة 3/);
  assert.match(ok(call('kb.article', { source: 'tax151', num: '28/1/4' }, user)).label, /الديون المعدومة/);
  assert.match(ok(call('kb.article', { source: 'penreg', num: '9' }, user)).text, /التلاعب في بيانات الحضور/);
});
t('arabic colloquial retrieval (same as v2)', () => {
  const cases = {
    'موظف غاب 3 أيام بدون إذن، ما الجزاء وهل يجوز فصله؟': [['penreg', '10'], ['labor14', '148']],
    'واحد اتأخر ساعة الصبح': [['penreg', '3']], 'موظف بيبصم لزميله': [['penreg', '9']],
    'الموظف كسر اللابتوب بتاع الشركة': [['labor14', '151']], 'كام ساعة أوفرتايم مسموح وبكام': [['labor14', '121']],
    'موظف مشي بدري من غير إذن': [['penreg', '6']], 'موظف بيستخدم الموبايل كتير في الشغل': [['penreg', '16']],
    'حصة الشركة في التأمينات كام': [['ins148', '19']], 'رفع بيانات العملاء على شات جي بي تي': [['penreg', '89']],
    'موظفة عايزة إجازة وضع': [['labor14', '54']], 'الموظف رفض يمضي على الإنذار': [['penreg', '30']],
    'مدير بيستغل سلطته على الموظفين': [['penreg', '55']], 'موظف نشر صور من المكتب على فيسبوك': [['penreg', '90']],
    'ديون عملاء مش بتتحصل نشطبها ضريبياً إزاي': [['tax151', '28/1/4']]
  };
  const miss = [];
  for (const [q, want] of Object.entries(cases)) {
    ctx.kbData_.memo = null; ctx.kbIndex_.memo = null;
    const got = ctx.kbRetrieve_(q).map(a => a.source + '|' + a.num);
    want.forEach(w => { if (!got.includes(w.join('|'))) miss.push(q + ' → ' + w.join(' ')); });
  }
  assert.deepStrictEqual(miss, []);
});
t('quote verification', () => {
  const a = ctx.getArticle_('labor14', '141').text;
  assert.strictEqual(ctx.quoteMatch_('لا يجوز توقيع جزاء على العامل إلا بعد إبلاغه كتابة ... على أن يبدأ التحقيق خلال سبعة أيام على الأكثر', a), 1);
  assert.strictEqual(ctx.quoteMatch_('يجوز فصل العامل فوراً دون تحقيق', a), 0);
});
t('PII redaction', () => {
  const r = ctx.redactPii_('الموظف رقمه القومي 29501011234567 وتليفونه 01012345678 وايميله a.b@x.com وحسابه EG380019000500000000263180002');
  assert.ok(!/2950101|01012345678|a\.b@x|EG38/.test(r.text), r.text);
  assert.ok(r.found.includes('national_id') && r.found.includes('phone') && r.found.includes('email') && r.found.includes('iban'));
  assert.strictEqual(ctx.redactPii_('غاب 3 أيام وخصمنا 500 جنيه').found.length, 0);
});
t('ask without key → search fallback', () => {
  const r = ok(call('ask', { question: 'موظف غاب 3 أيام بدون إذن', mode: 'case' }, user));
  assert.strictEqual(r.provider, 'search'); assert.match(r.notice, /مفتاح Gemini/); assert.ok(r.answer.legal_texts.length > 0); assert.ok(r.verification.all_ok);
});
t('save key (admin) + ask via Gemini', () => {
  ok(call('admin.saveApiKey', { key: 'AIzaSyTEST_KEY_1234567890abcdef' }, admin));
  const r = ok(call('ask', { question: 'موظف غاب 3 أيام بدون إذن ورقمه القومي 29501011234567', mode: 'case' }, user));
  assert.strictEqual(r.provider, 'gemini'); assert.ok(r.verification.all_ok, JSON.stringify(r.verification));
  const sent = geminiCalls[geminiCalls.length - 1];
  assert.ok(!JSON.stringify(sent.body).includes('29501011234567'), 'national id leaked to Gemini');
  assert.strictEqual(sent.headers['x-goog-api-key'], 'AIzaSyTEST_KEY_1234567890abcdef');
  assert.ok(sent.url.includes('gemini-3.5-flash-lite'));
  assert.ok(sent.body.generationConfig.responseSchema.properties.legal_texts);
  assert.ok(r.redactions.includes('national_id'));
  assert.ok(!sheets.Questions.data.map(x => x.join('|')).join('\n').includes('29501011234567'), 'national id stored in log');
});
t('Gemini quota → fallback', () => {
  process.env.GEMINI_MODE = 'quota';
  const r = ok(call('ask', { question: 'ما الحد الأقصى للخصم من الأجر؟' }, user));
  assert.strictEqual(r.provider, 'search'); assert.match(r.notice, /انتهت حصة Gemini/);
  process.env.GEMINI_MODE = 'ok';
});
t('history + feedback + isolation', () => {
  const mine = ok(call('history', {}, user));
  assert.ok(mine.length >= 3);
  const item = ok(call('history.get', { id: mine[0].id }, user));
  assert.ok(item.answer.summary);
  ok(call('feedback', { id: mine[0].id, rating: 'bad', note: 'test' }, user));
  const other = ok(call('auth.login', { username: 'user3', password: 'Pass12343' })).token;
  assert.strictEqual(ok(call('history', {}, other)).length, 0);
  fail(call('history.get', { id: mine[0].id }, other));
  assert.ok(ok(call('history', {}, admin)).length >= 3);
});
t('penalties assess (violation 9, second time, manager)', () => {
  const r = ok(call('pen.assess', { violation_num: 9, previous_count: 1, last_penalty_notice: '2026-03-01', discovered_on: '2026-11-01',
    investigation_started: '2026-11-03', investigation_ended: '2026-11-05', daily_basic_wage: 300, deducted_days_this_month: 1, signer: 'manager', today: '2026-11-13' }, user));
  assert.strictEqual(r.max_penalty.text, 'خصم خمسة أيام');
  assert.strictEqual(r.deduction.allowed_this_month, 4); assert.strictEqual(r.deduction.amount, 1500);
  assert.ok(r.warnings.some(w => /مدير المنشأة/.test(w)));
  assert.deepStrictEqual(r.deadlines.map(d => d.date), ['2026-11-08', '2027-02-03', '2026-12-05']);
});
t('penalties: recidivism older than 1 year resets', () => {
  const r = ok(call('pen.assess', { violation_num: 10, previous_count: 2, last_penalty_notice: '2025-01-01', discovered_on: '2026-11-01' }, user));
  assert.strictEqual(r.occurrence, 1); assert.strictEqual(r.max_penalty.text, 'خصم يوم');
});
t('penalties: >60 min late uses absence + uncertain cell flagged', () => {
  const r = ok(call('pen.assess', { violation_num: 3, previous_count: 0 }, user));
  assert.match(r.max_penalty.text, /جزاء الغياب: خصم يوم/);
  const r2 = ok(call('pen.assess', { violation_num: 19 }, user));
  assert.ok(r2.warnings.some(w => /شبه ممحوة/.test(w)));
});
t('admin adds violation 62 → visible everywhere', () => {
  ok(call('admin.penSave', { num: 62, section: 'ثالثاً: (عنوان القسم في الصفحات الناقصة من الملف)', text: 'مخالفة تجريبية للاختبار', c1: 'W', c2: '1', c3: '2', c4: '3' }, admin));
  assert.strictEqual(ok(call('pen.assess', { violation_num: 62, previous_count: 1 }, user)).max_penalty.text, 'خصم يوم');
  assert.match(ok(call('kb.article', { source: 'penreg', num: '62' }, user)).text, /تجريبية/);
  assert.ok(!ok(call('pen.list', {}, user)).missing.includes(62));
  ok(call('admin.penDelete', { num: 62 }, admin));
  fail(call('kb.article', { source: 'penreg', num: '62' }, user));
});
t('calculators', () => {
  const o = ok(call('calc', { type: 'overtime', wage: 9000, day_hours: 10, night_hours: 4, rest_days: 1, presence: 13 }, user));
  assert.strictEqual(o.total.amount, 1061.25); assert.ok(/12 ساعة/.test(o.warnings[0]));
  const i = ok(call('calc', { type: 'insurance', wage: 8000, year: 2026 }, user));
  assert.deepStrictEqual([i.totals.employer, i.totals.employee, i.totals.employer_rate, i.totals.employee_rate], [1500, 880, 18.75, 11]);
  ok(call('admin.saveSettings', { insurance_year: 2026, insurance_min: 2700, insurance_max: 16700 }, admin));
  assert.strictEqual(ok(call('calc', { type: 'insurance', wage: 20000, year: 2026 }, user)).insured_wage, 16700);
  assert.ok(ok(call('calc', { type: 'tax', wage: 9000 }, user)).error);
  ok(call('admin.saveSettings', { tax_brackets: '40000, 0\n55000, 10\n-, 20', tax_exemption: 20000, tax_source: 'اختبار' }, admin));
  const tx = ok(call('calc', { type: 'tax', wage: 9000 }, user));
  assert.ok(tx.total.amount > 0);
  const dd = ok(call('calc', { type: 'deduction', wage: 9000, penalty_days: 7, already: 2, damage: 25000 }, user));
  assert.strictEqual(dd.warnings.length, 4);
});
t('documents generate (decision) with violation text', () => {
  const r = ok(call('docs.generate', { doc_type: 'decision', fields: { employee_name: 'عامل تجريبي', violation_num: '9', penalty_text: 'خصم خمسة أيام', findings: 'ثبت التلاعب' } }, user));
  assert.ok(r.docUrl && r.pdfUrl);
  const doc = Object.values(createdDocs).slice(-1)[0];
  const txt = doc.lines.map(l => l.text).join('\n');
  assert.ok(/المخالفة رقم \(9\)/.test(txt) && /قرر/.test(txt) && /خصم خمسة أيام/.test(txt), txt.slice(0, 300));
  assert.strictEqual(ok(call('docs.recent', {}, user)).length, 1);
});
t('free + paid keys: fallback to paid when free quota ends', () => {
  fail(call('admin.saveApiKey', { tier: 'paid', key: 'short' }, admin), /شكل المفتاح/);
  ok(call('admin.saveApiKey', { tier: 'paid', key: 'AQ.Ab8_PAID-test.key1234567890' }, admin));
  process.env.GEMINI_MODE = 'quota_free'; process.env.FREE_KEY = 'AIzaSyTEST_KEY_1234567890abcdef';
  const r = ok(call('ask', { question: 'ما مدة الإجازة السنوية؟' }, user));
  assert.strictEqual(r.provider, 'gemini'); assert.match(r.model, /المدفوع/);
  assert.strictEqual(geminiCalls[geminiCalls.length - 1].headers['x-goog-api-key'], 'AQ.Ab8_PAID-test.key1234567890');
  ok(call('admin.saveSettings', { ai_mode: 'free_only' }, admin));
  assert.strictEqual(ok(call('ask', { question: 'ما مدة الإجازة السنوية؟' }, user)).provider, 'search');
  ok(call('admin.saveSettings', { ai_mode: 'free_first' }, admin));
  fail(call('admin.saveSettings', { ai_mode: 'xx' }, admin));
  process.env.GEMINI_MODE = 'ok';
  const t2 = ok(call('admin.testAi', {}, admin));
  assert.strictEqual(t2.results.length, 2); assert.ok(t2.ok);
  const o = ok(call('admin.overview', {}, admin));
  assert.ok(o.ai.hasFree && o.ai.hasPaid); assert.ok(o.ai.usedPaid >= 1);
  fail(call('admin.saveApiKey', { tier: 'paid', key: 'AQ.Ab8_PAID-test.key1234567890' }, user), /لمدير النظام/);
});
t('law editing: new source, paste split, edit, delete, AI sees it', () => {
  const sp = ok(call('admin.splitText', { text: 'الباب الأول: أحكام عامة\nمادة (1)\nتلتزم الشركة بصرف بدل انتقال شهري للعاملين بالإدارة.\nمادة ٢ مكرر\nيستحق بدل الانتقال من أول الشهر.\nالمادة الثالثة\nيسقط البدل في الإجازات بدون أجر.' }, admin));
  assert.deepStrictEqual(sp.articles.map(a => a.num), ['1', '2 مكرر', '3']);
  assert.strictEqual(sp.articles[0].chapter, 'الباب الأول: أحكام عامة');
  fail(call('admin.sourceSave', { isNew: true, id: 'Bad Id', title: 'لائحة بدلات الشركة' }, admin), /الرمز/);
  const s = ok(call('admin.sourceSave', { isNew: true, id: 'allowances', title: 'لائحة بدلات الشركة الداخلية', short: 'لائحة البدلات', notes: 'معتمدة 2026' }, admin));
  fail(call('admin.sourceSave', { isNew: true, id: 'allowances', title: 'مكرر مكرر' }, admin), /مستخدم/);
  const r = ok(call('admin.articlesSave', { source: s.id, articles: sp.articles }, admin));
  assert.deepStrictEqual([r.added, r.updated], [3, 0]);
  assert.ok(ok(call('kb.sources', {}, user)).some(x => x.id === 'allowances' && x.count === 3 && !x.core));
  assert.match(ok(call('kb.article', { source: 'allowances', num: '2 مكرر' }, user)).text, /أول الشهر/);
  // تعديل نص ورقم مادة
  ok(call('admin.articlesSave', { source: 'allowances', origNum: '3', articles: [{ num: '4', label: 'مادة (4)', text: 'يسقط بدل الانتقال في الإجازات بدون أجر والجزاءات.' }] }, admin));
  fail(call('kb.article', { source: 'allowances', num: '3' }, user));
  assert.match(ok(call('kb.article', { source: 'allowances', num: '4' }, user)).text, /والجزاءات/);
  // البحث والذكاء الاصطناعي يريان المرجع الجديد
  assert.ok(ok(call('kb.search', { q: 'بدل انتقال' }, user)).results.some(x => x.source === 'allowances'));
  ok(call('ask', { question: 'متى يستحق بدل الانتقال؟' }, user));
  const sent = geminiCalls[geminiCalls.length - 1].body;
  assert.match(sent.systemInstruction.parts[0].text, /allowances: لائحة بدلات الشركة الداخلية/);
  assert.ok(sent.generationConfig.responseSchema.properties.legal_texts.items.properties.source.enum.includes('allowances'));
  // تعديل مادة في قانون أساسي ثم إرجاعها
  const old = ok(call('kb.article', { source: 'labor14', num: '1' }, user));
  ok(call('admin.articlesSave', { source: 'labor14', articles: [{ num: '1', label: old.label, chapter: old.chapter, text: old.text + ' (تعديل تجريبي)' }] }, admin));
  assert.match(ok(call('kb.article', { source: 'labor14', num: '1' }, user)).text, /تعديل تجريبي/);
  ok(call('admin.articlesSave', { source: 'labor14', articles: [{ num: '1', label: old.label, chapter: old.chapter, text: old.text }] }, admin));
  fail(call('admin.articlesSave', { source: 'penreg', articles: [{ num: '1', text: 'xxxx' }] }, admin), /الجزاءات/);
  fail(call('admin.sourceDelete', { id: 'labor14' }, admin), /الأساسية/);
  fail(call('admin.articlesSave', { source: 'allowances', articles: [{ num: '9', text: 'نص' }] }, user), /لمدير النظام/);
  ok(call('admin.articleDelete', { source: 'allowances', num: '4' }, admin));
  assert.strictEqual(ok(call('kb.list', { source: 'allowances' }, user)).articles.length, 2);
});
t('extract articles from image (chunked upload) → review → save', () => {
  const b64 = Buffer.from('fake image bytes '.repeat(9000)).toString('base64');
  const size = 80000, n = Math.ceil(b64.length / size);
  for (let i = 0; i < n; i++) ok(call('admin.extractUpload', { index: i, total: n, chunk: b64.substr(i * size, size) }, admin));
  fail(call('admin.extract', { mime: 'text/html', total: n }, admin), /غير مدعوم/);
  const r = ok(call('admin.extract', { mime: 'image/jpeg', total: n }, admin));
  assert.deepStrictEqual(r.articles.map(a => a.num), ['1', '2']);
  const sent = geminiCalls[geminiCalls.length - 1].body.contents[0].parts[0].inlineData;
  assert.strictEqual(sent.mimeType, 'image/jpeg'); assert.strictEqual(sent.data, b64);
  fail(call('admin.extract', { mime: 'image/jpeg', total: n }, admin), /لم يكتمل/); // الأجزاء تُمسح بعد الاستخدام
  ok(call('admin.articlesSave', { source: 'allowances', articles: r.articles }, admin));
  ok(call('admin.sourceDelete', { id: 'allowances' }, admin));
  assert.ok(!ok(call('kb.sources', {}, user)).some(x => x.id === 'allowances'));
  assert.ok(!sheets.Articles.data.some(row => row[0] === 'allowances'));
});
t('doPost (GitHub Pages app) uses same api + auth', () => {
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  assert.strictEqual(post({ action: 'auth.status' }).ok, true);
  assert.strictEqual(post({ action: 'kb.sources', token: 'bad' }).auth, false);
  assert.ok(post({ action: 'kb.sources', token: user }).data.length >= 5);
  assert.strictEqual(post({ action: 'admin.overview', token: user }).ok, false);
  assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).text).ok, false);
  assert.match(ok(call('auth.me', {}, user)).company, /\S/);
});
t('email login, google sign-in, forgot/reset, set email', () => {
  ok(call('auth.login', { email: 'user1@fs.com', password: 'Pass12341' }));
  fail(call('admin.userCreate', { fullName: 'مكرر', email: 'USER1@fs.com', password: 'Pass12345' }, admin), /مسجل بالفعل/);
  fail(call('admin.userCreate', { fullName: 'غلط', email: 'not-an-email', password: 'Pass12345' }, admin), /إيميل صحيح/);
  // Google
  fail(call('auth.google', { credential: 'a.b.c' }), /غير مفعّل/);
  fail(call('admin.saveSettings', { google_client_id: 'abc' }, admin), /Client ID/);
  const CID = '123456-abcdef.apps.googleusercontent.com';
  ok(call('admin.saveSettings', { google_client_id: CID }, admin));
  assert.strictEqual(ok(call('auth.status')).googleClientId, CID);
  const jwt = info => 'h.' + Buffer.from(JSON.stringify(info)).toString('base64url') + '.s';
  const good = { aud: CID, iss: 'https://accounts.google.com', email: 'user1@fs.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) };
  assert.strictEqual(ok(call('auth.google', { credential: jwt(good) })).user.username, 'user1');
  fail(call('auth.google', { credential: jwt({ ...good, aud: 'other.apps.googleusercontent.com' }) }), /تعذر التحقق/);
  fail(call('auth.google', { credential: jwt({ ...good, email_verified: 'false' }) }), /تعذر التحقق/);
  fail(call('auth.google', { credential: jwt({ ...good, email: 'stranger@gmail.com' }) }), /غير مسجل/);
  // نسيت كلمة المرور
  const before = sentMails.length;
  ok(call('auth.forgot', { email: 'nobody@fs.com' }));
  assert.strictEqual(sentMails.length, before, 'no mail for unknown email');
  ok(call('auth.forgot', { email: 'user2@fs.com' }));
  assert.strictEqual(sentMails.length, before + 1);
  const mail = sentMails[sentMails.length - 1];
  assert.strictEqual(mail.to, 'user2@fs.com');
  const code = mail.htmlBody.match(/>(\d{6})</)[1];
  fail(call('auth.reset', { email: 'user2@fs.com', code: '000000', password: 'Fresh12345' }), /غير صحيح/);
  const r = ok(call('auth.reset', { email: 'user2@fs.com', code, password: 'Fresh12345' }));
  assert.ok(r.token);
  fail(call('auth.reset', { email: 'user2@fs.com', code, password: 'Fresh12345' }), /انتهت صلاحيته/);
  ok(call('auth.login', { email: 'user2@fs.com', password: 'Fresh12345' }));
  // حساب قديم بدون إيميل يربط إيميله
  ok(call('auth.setEmail', { email: 'boss@fs.com' }, admin));
  fail(call('auth.setEmail', { email: 'user1@fs.com' }, admin), /مستخدم لحساب آخر/);
  ok(call('auth.login', { email: 'boss@fs.com', password: 'Admin12345' }));
  ok(call('auth.login', { username: 'admin', password: 'Admin12345' })); // اسم المستخدم القديم ما زال يعمل
  ok(call('admin.userEmail', { username: 'user3', email: 'u3@fs.com' }, admin));
  ok(call('auth.login', { email: 'u3@fs.com', password: 'Pass12343' }));
});
t('favorites, news, dashboard', () => {
  let f = ok(call('fav.toggle', { source: 'labor14', num: '47' }, user));
  assert.ok(f.on);
  ok(call('fav.toggle', { source: 'penreg', num: '9' }, user));
  const list = ok(call('fav.list', {}, user));
  assert.deepStrictEqual(list.items.map(x => x.source + '|' + x.num), ['penreg|9', 'labor14|47']);
  f = ok(call('fav.toggle', { source: 'labor14', num: '47' }, user));
  assert.ok(!f.on);
  fail(call('fav.toggle', { source: 'labor14', num: '99999' }, user));
  const dsh = ok(call('dash', {}, user));
  assert.ok(dsh.stats.articles > 600); assert.ok(dsh.stats.violations >= 86); assert.strictEqual(dsh.favorites, 1);
  assert.strictEqual(dsh.stats.teamMonth, null);
  assert.ok(ok(call('dash', {}, admin)).stats.teamMonth >= 1);
  assert.ok(Array.isArray(dsh.recent));
  const news = ok(call('news', {}, user)).items;
  assert.ok(news.some(n => /لائحة البدلات|بدلات/.test(n.text)), JSON.stringify(news.slice(0, 3)));
});
t('users sheet migration adds email/favorites columns', () => {
  const head = sheets.Users.data[0];
  assert.ok(head.includes('email') && head.includes('favorites'));
});
t('admin overview', () => {
  const o = ok(call('admin.overview', {}, admin));
  assert.strictEqual(o.users.length, 4); assert.ok(o.ai.hasKey); assert.ok(o.ai.usedToday >= 1); assert.strictEqual(o.missingViolations.length, 16);
});
t('change password + logout', () => {
  ok(call('auth.changePassword', { oldPassword: 'Pass12341', newPassword: 'NewPass999' }, user));
  ok(call('auth.logout', {}, user));
  assert.strictEqual(call('kb.sources', {}, user).auth, false);
  ok(call('auth.login', { username: 'user1', password: 'NewPass999' }));
});
console.log('\n' + pass + ' passed' + (process.exitCode ? ', some FAILED' : ''));
