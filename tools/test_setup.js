/** اختبار الإعداد الأول على جدول فارغ: رفع ملف البيانات على أجزاء + استيراده + إنشاء المدير. */
process.env.EMPTY = '1';
process.argv[2] = process.argv[2] || process.env.DATA_FILE || __dirname + '/../data/FullSpeed_Legal_Data.json';
const fs = require('fs'), assert = require('assert');
const H = require('./harness');
const call = (action, data, token) => H.callApi({ action, data, token });
const text = fs.readFileSync(process.argv[2], 'utf8');
const st = call('auth.status');
assert.ok(st.ok && !st.data.hasUsers && !st.data.hasData, JSON.stringify(st));
const code = H.ctx.createSetupCode();
assert.ok(!call('setup.upload', { setupCode: 'WRONG', index: 0, total: 1, chunk: 'x' }).ok, 'wrong code accepted');
const size = 80000, total = Math.ceil(text.length / size);
for (let i = 0; i < total; i++) { const r = call('setup.upload', { setupCode: code, index: i, total, chunk: text.substr(i * size, size) }); assert.ok(r.ok, r.error); }
const r = call('auth.setup', { setupCode: code, fullName: 'مدير', username: 'admin', password: 'Admin12345', dataParts: total });
assert.ok(r.ok, r.error);
console.log('imported', r.data.imported, 'chunks', total);
assert.strictEqual(H.sheets.Articles.getLastRow() - 1, H.seed.Articles.length);
assert.strictEqual(H.sheets.Penalties.getLastRow() - 1, H.seed.Penalties.length);
assert.strictEqual(H.sheets.Penalties.validations.length, 2);
const tok = call('auth.login', { username: 'admin', password: 'Admin12345' }).data.token;
const counts = Object.fromEntries(call('kb.sources', {}, tok).data.map(x => [x.id, x.count]));
assert.deepStrictEqual(counts, { labor14: 311, workreg: 112, penreg: 86, ins148: 176, tax151: 18 });
// النص مطابق للأصل حرفياً
const art = call('kb.article', { source: 'labor14', num: '141' }, tok).data.text;
assert.strictEqual(art, H.seed.Articles.find(a => a[0] === 'labor14' && a[1] === '141')[6]);
// تحديث البيانات لاحقاً من الإدارة
for (let i = 0; i < total; i++) assert.ok(call('admin.upload', { index: i, total, chunk: text.substr(i * size, size) }, tok).ok);
const re = call('admin.importData', { total }, tok);
assert.ok(re.ok, re.error);
assert.strictEqual(H.sheets.Articles.getLastRow() - 1, H.seed.Articles.length);
console.log('setup + import tests passed');
