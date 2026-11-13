/** اختبار الواجهة في متصفح حقيقي عبر بيئة المحاكاة + لقطات شاشة للكمبيوتر والموبايل. */
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = 'http://localhost:8090';
const errors = [];
const fs = require('fs');
const FONTS = process.env.FONT_DIR;

// المتصفح التجريبي لا يمر عبر بروكسي البيئة؛ نقدم ملفات الخط من نسخة محلية
async function routeFonts(page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => {
    const url = route.request().url();
    if (!FONTS) return route.abort();
    if (url.includes('googleapis')) return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(FONTS + '/fonts.css', 'utf8') });
    const f = url.replace('https://fonts.gstatic.com/', '').replace(/\//g, '_');
    return fs.existsSync(FONTS + '/' + f) ? route.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(FONTS + '/' + f) }) : route.abort();
  });
}

(async () => {
  const b = await chromium.launch();
  const desk = await b.newPage({ viewport: { width: 1366, height: 860 } });
  await routeFonts(desk);
  desk.on('pageerror', e => errors.push('pageerror: ' + e.message));
  desk.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // الإعداد الأول
  const code = await (await fetch(BASE + '/__setup')).text();
  await desk.goto(BASE);
  await desk.waitForSelector('#setup');
  await desk.screenshot({ path: OUT + '/g_setup.png' });
  await desk.fill('#sc', code);
  await desk.setInputFiles('#df', process.env.DATA_FILE);
  await desk.fill('#fn', 'محمد مصطفى'); await desk.fill('#su', 'admin'); await desk.fill('#sp', 'Admin12345');
  await desk.click('#go');
  await desk.waitForSelector('#login', { timeout: 90000 });
  await desk.screenshot({ path: OUT + '/g_login.png' });
  await desk.fill('#u', 'admin'); await desk.fill('#p', 'Admin12345'); await desk.click('#go');
  await desk.waitForSelector('#q');
  await desk.screenshot({ path: OUT + '/g_ask_empty.png' });

  // الإدارة: إضافة مفتاح Gemini ومستخدم
  await desk.click('.nav a[data-view=admin]');
  await desk.waitForSelector('#akey');
  await desk.fill('#akey', 'AIzaSyTEST_KEY_1234567890abcdef');
  await desk.click('#asave');
  await desk.waitForSelector('#nfn');
  await desk.fill('#nfn', 'سارة الموارد البشرية'); await desk.fill('#nun', 'sara.hr'); await desk.fill('#npw', 'Sara12345');
  await desk.click('#nadd');
  await desk.waitForFunction(() => document.body.innerText.includes('sara.hr'));
  await desk.screenshot({ path: OUT + '/g_admin.png', fullPage: true });

  // السؤال + تنبيه البيانات الشخصية
  await desk.click('.nav a[data-view=ask]');
  await desk.fill('#q', 'الموظف أحمد سامي غاب 3 أيام بدون إذن ورقمه القومي 29501011234567، ما الجزاء وهل يجوز فصله؟');
  await desk.click('#send');
  await desk.waitForSelector('.modal');
  await desk.screenshot({ path: OUT + '/g_pii.png' });
  await desk.click('[data-a=redact]');
  await desk.waitForSelector('.answer');
  await desk.screenshot({ path: OUT + '/g_answer.png', fullPage: true });
  const sent = await (await fetch(BASE + '/__state')).json();
  const sentText = JSON.stringify(sent.lastGemini.body);
  if (/أحمد سامي|29501011234567/.test(sentText)) errors.push('PII leaked to Gemini');
  await desk.click('.answer .chip');
  await desk.waitForFunction(() => document.querySelector('.modal-h h3') && !document.querySelector('.modal-h h3').textContent.includes('التحميل'));
  await desk.screenshot({ path: OUT + '/g_article.png' });
  await desk.click('[data-close]');

  // الجزاءات
  await desk.click('.nav a[data-view=penalties]');
  await desk.waitForSelector('#vs');
  await desk.fill('#vs', 'التلاعب');
  await desk.click('.vitem[data-n="9"]');
  await desk.fill('#prev', '1');
  await desk.selectOption('#signer', 'manager');
  await desk.click('#calcp');
  await desk.waitForSelector('#pout .result-big');
  await desk.screenshot({ path: OUT + '/g_penalties.png', fullPage: true });

  // الحاسبات
  await desk.click('.nav a[data-view=calc]');
  await desk.click('#ct button[data-c=insurance]');
  await desk.fill('#cform input[name=wage]', '8000');
  await desk.click('#cgo');
  await desk.waitForSelector('#cout .card');
  await desk.screenshot({ path: OUT + '/g_calc.png', fullPage: true });

  // المستندات
  await desk.click('.nav a[data-view=docs]');
  await desk.waitForSelector('#dgo');
  await desk.click('#dt button[data-t=decision]');
  await desk.fill('[name=employee_name]', 'عامل تجريبي');
  await desk.selectOption('[name=violation_num]', '9');
  await desk.click('#dgo');
  await desk.waitForSelector('#dres .alert.ok');
  await desk.screenshot({ path: OUT + '/g_docs.png', fullPage: true });

  // القوانين
  await desk.click('.nav a[data-view=laws]');
  await desk.waitForSelector('.src-card');
  await desk.fill('#ls', 'الإجازة السنوية'); await desk.click('#lgo');
  await desk.waitForSelector('#lres .art');
  await desk.screenshot({ path: OUT + '/g_laws.png' });

  // تعديل القوانين: مرجع جديد + لصق نص + مراجعة + حفظ
  await desk.click('#lnew');
  await desk.fill('#sft', 'لائحة بدلات الشركة الداخلية'); await desk.fill('#sfs', 'لائحة البدلات');
  await desk.click('#sfgo');
  await desk.waitForSelector('#eadd');
  await desk.click('#eadd');
  await desk.click('#et button[data-t=paste]');
  await desk.fill('#ep', 'مادة (1)\nتلتزم الشركة بصرف بدل انتقال شهري.\nمادة (2)\nيستحق البدل من أول الشهر.');
  await desk.click('#esplit');
  await desk.waitForSelector('.pv');
  await desk.screenshot({ path: OUT + '/g_editor.png' });
  await desk.click('#esave');
  await desk.waitForFunction(() => document.querySelectorAll('#al .art').length === 2);
  await desk.click('[data-ae="2"]');
  await desk.waitForSelector('#ex');
  await desk.fill('#ex', 'يستحق البدل من أول الشهر التالي للتعيين.');
  await desk.click('#esave');
  await desk.waitForFunction(() => document.body.innerText.includes('التالي للتعيين'));
  await desk.click('#et, body').catch(() => {});
  await desk.click('#et button[data-t=file]').catch(() => {});
  await desk.screenshot({ path: OUT + '/g_source.png', fullPage: true });

  // الموبايل
  const mob = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await routeFonts(mob);
  mob.on('pageerror', e => errors.push('mob pageerror: ' + e.message));
  await mob.goto(BASE);
  await mob.waitForSelector('#login');
  await mob.screenshot({ path: OUT + '/m_login.png' });
  await mob.fill('#u', 'sara.hr'); await mob.fill('#p', 'Sara12345'); await mob.click('#go');
  await mob.waitForSelector('#q');
  await mob.screenshot({ path: OUT + '/m_ask.png' });
  await mob.fill('#q', 'موظف مشي بدري من غير إذن للمرة الثانية');
  await mob.click('#send');
  await mob.waitForSelector('.answer');
  await mob.screenshot({ path: OUT + '/m_answer.png', fullPage: true });
  await mob.click('.bottomnav a[data-view=penalties]');
  await mob.waitForSelector('.vitem');
  await mob.click('.vitem[data-n="6"]');
  await mob.click('#calcp');
  await mob.waitForSelector('#pout .result-big');
  await mob.screenshot({ path: OUT + '/m_penalties.png', fullPage: true });
  await mob.click('.bottomnav a[data-view=more]');
  await mob.waitForSelector('.sheet-menu');
  await mob.screenshot({ path: OUT + '/m_more.png' });
  const sw = await mob.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 390) errors.push('mobile horizontal overflow: ' + sw);
  // مستخدم عادي لا يرى الإدارة
  if (await mob.$('.sheet-menu a[data-go=admin]')) errors.push('non-admin sees admin menu');

  await b.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'UI OK, no errors');
})().catch(e => { console.error('FAILED:', e.message, '\n', errors.join('\n')); process.exit(1); });
