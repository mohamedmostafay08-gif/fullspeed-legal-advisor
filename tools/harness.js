/**
 * بيئة اختبار محلية تحاكي خدمات Google Apps Script (Sheets, Cache, Properties, Utilities, UrlFetch, Drive, Docs)
 * وتشغّل ملفات .gs كما هي، مع خادم HTTP يقدم الواجهة ويحوّل google.script.run إلى طلبات محلية.
 *
 *   node tools/harness.js <ملف JSON للبيانات> [المنفذ]
 *
 * متغير GEMINI_MODE: ok (افتراضي) | quota | down
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'apps-script');
const dataFile = process.argv[2];
const PORT = +(process.argv[3] || 8090);
const seed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const SHEET_HEADS = {
  Sources: ['id', 'title', 'short', 'citation', 'pdf', 'notes'],
  Articles: ['source', 'num', 'label', 'chapter', 'page', 'also_contains', 'text'],
  Penalties: ['num', 'section', 'text', 'case_label', 'first', 'second', 'third', 'fourth', 'uncertain', 'page', 'manual', 'entered_by', 'entered_at'],
  Users: ['username', 'full_name', 'role', 'salt', 'hash', 'active', 'created_at', 'last_login'],
  Questions: ['id', 'time', 'username', 'mode', 'question', 'provider', 'model', 'answer_json', 'verification_json', 'feedback', 'feedback_note', 'redactions'],
  Documents: ['time', 'username', 'doc_type', 'employee', 'doc_url', 'pdf_url'],
  Settings: ['key', 'value']
};

// ---------------- Sheets ----------------
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; vals.push(v === undefined || v === null ? '' : v); }
      out.push(vals);
    }
    return out;
  }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) if (this.sh.data[this.r - 1 + i]) this.sh.set(this.r + i, this.c + j, ''); return this; }
  setDataValidation(v) { this.sh.validations = (this.sh.validations || []).concat([v]); return this; }
  sort(spec) {
    const rows = this.sh.data.slice(this.r - 1, this.r - 1 + this.nr);
    const k = spec.column - 1;
    rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (spec.ascending === false ? -1 : 1));
    this.sh.data.splice(this.r - 1, rows.length, ...rows);
    return this;
  }
}
class Sheet {
  constructor(name, data) { this.name = name; this.data = data; }
  getName() { return this.name; }
  set(r, c, x) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = x; }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every(v => v === '' || v === undefined || v === null)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') { // A1 مثل E2:H400
      const m = r.match(/^([A-Z])(\d+):([A-Z])(\d+)$/);
      const col = x => x.charCodeAt(0) - 64;
      return new Range(this, +m[2], col(m[1]), +m[4] - +m[2] + 1, col(m[3]) - col(m[1]) + 1);
    }
    return new Range(this, r, c, nr, nc);
  }
  appendRow(vals) { this.data.splice(this.getLastRow(), 0, vals.slice()); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {} setRightToLeft() {}
}
const sheets = {};
// EMPTY=1: جدول فارغ تماماً مثل جدول المستخدم الجديد (يُنشئ البرنامج الأوراق ويستورد البيانات بنفسه)
if (!process.env.EMPTY) for (const [name, head] of Object.entries(SHEET_HEADS)) sheets[name] = new Sheet(name, [head.slice()].concat((seed[name] || []).map(r => r.slice())));
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = new Sheet(n, [])),
  getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST'
};

// ---------------- Cache / Properties / Lock ----------------
const cacheStore = new Map();
const cache = {
  get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
  put: (k, v) => { if (String(v).length > 100000) throw new Error('Argument too large: ' + k); cacheStore.set(k, String(v)); },
  getAll: ks => { const o = {}; ks.forEach(k => { if (cacheStore.has(k)) o[k] = cacheStore.get(k); }); return o; },
  putAll: m => Object.entries(m).forEach(([k, v]) => cache.put(k, v)),
  remove: k => cacheStore.delete(k),
  removeAll: ks => ks.forEach(k => cacheStore.delete(k))
};
const props = new Map();
const propsSvc = { getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)), deleteProperty: k => props.delete(k) };

// ---------------- Utilities ----------------
const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => (b < 0 ? b + 256 : b))));
function fmtDate(d, tz, f) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
}
const Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, v) => toSigned(crypto.createHash(alg).update(toBuf(v)).digest()),
  base64Encode: b => toBuf(b).toString('base64'),
  getUuid: () => crypto.randomUUID(),
  formatDate: fmtDate,
  newBlob: s => ({ getBytes: () => toSigned(Buffer.from(s, 'utf8')) }),
  sleep: () => {}
};

// ---------------- Gemini (محاكاة) ----------------
let geminiCalls = [];
const sentMails = [];
const UrlFetchApp = {
  fetch(url, opt) {
    // التحقق من رمز Google: الرمز التجريبي "x.<base64 JSON>.y" ومحتواه يُعاد كما هو
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      const tok = decodeURIComponent((url.split('id_token=')[1] || ''));
      try { const info = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(info) }; }
      catch (e) { return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' }; }
    }
    const mode = process.env.GEMINI_MODE || 'ok';
    const body = JSON.parse(opt.payload);
    geminiCalls.push({ url, headers: opt.headers, body });
    const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
    if (mode === 'quota') return resp(429, { error: { code: 429, message: 'Resource exhausted' } });
    // quota_free: المفتاح المجاني انتهت حصته فقط (لاختبار الانتقال للمفتاح المدفوع)
    if (mode === 'quota_free' && opt.headers['x-goog-api-key'] === process.env.FREE_KEY) return resp(429, { error: { code: 429, message: 'Resource exhausted' } });
    const first = body.contents[0].parts[0];
    if (first.inlineData) { // استخراج نص من صورة/PDF
      const arts = [{ num: '1', label: 'مادة (1)', chapter: 'الباب الأول', text: 'نص مستخرج تجريبي للمادة الأولى عن بدل الانتقال.' },
                    { num: 'الثانية', label: 'المادة الثانية', chapter: '', text: 'نص مستخرج تجريبي للمادة الثانية.' }];
      return resp(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ articles: arts }) }] } }], usageMetadata: {} });
    }
    if (mode === 'down') return resp(503, { error: { code: 503 } });
    const user = body.contents[0].parts[0].text;
    const arts = [...user.matchAll(/<article source="(\w+)" num="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/article>/g)];
    const pick = arts.slice(0, 2).map(m => ({ source: m[1], article: m[2], quote: m[3].split(/\s+/).slice(0, 16).join(' '), relevance: 'مرتبطة بالسؤال (رد تجريبي)' }));
    const ans = {
      found: true, confidence: 'explicit', summary: 'رد تجريبي من المحاكاة: الإجابة مبنية على المواد المرفقة.',
      legal_texts: pick, explanation: '- نقطة أولى للتوضيح.\n- نقطة **ثانية** مهمة.',
      cross_law: arts.length > 2 ? [{ source: arts[2][1], article: arts[2][2], note: 'ارتباط تجريبي' }] : [],
      examples: [{ title: 'محاسب في الإدارة المالية', scenario: 'حالة أولى للتجربة.', outcome: 'نتيجة أولى.' },
                 { title: 'أمين مخزن', scenario: 'حالة ثانية للتجربة.', outcome: 'نتيجة ثانية.' }],
      clarifying_questions: ['هل سبق توقيع جزاء على نفس المخالفة خلال سنة؟'], missing_references: []
    };
    if (opt.payload.length > 300000) throw new Error('payload too big');
    return resp(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }], usageMetadata: { promptTokenCount: Math.round(user.length / 3), candidatesTokenCount: 500 } });
  }
};

// ---------------- Drive / Docs (محاكاة مبسطة) ----------------
let docCounter = 0;
const createdDocs = {};
const DriveApp = {
  getFilesByName: () => ({ hasNext: () => false }),
  createFolder: () => ({ getId: () => 'FOLDER', createFile: blob => ({ setName: () => ({ getUrl: () => 'https://drive.google.com/file/PDF' + docCounter }) }) }),
  getFolderById: () => DriveApp.createFolder(),
  getFileById: () => ({ moveTo() {}, getAs: () => ({}) })
};
function para(store) {
  const p = {
    text: '', setLeftToRight() { return p; }, setAlignment() { return p; }, setSpacingAfter() { return p; }, setText(t) { p.text = t; return p; },
    editAsText() { const t = { setFontFamily: () => t, setFontSize: () => t, setBold: () => t, setForegroundColor: () => t }; return t; }
  };
  store.push(p);
  return p;
}
const DocumentApp = {
  HorizontalAlignment: { CENTER: 'C', RIGHT: 'R' },
  create(title) {
    const id = 'DOC' + (++docCounter), lines = [];
    const body = {
      setMarginTop() { return body; }, setMarginBottom() { return body; }, setMarginLeft() { return body; }, setMarginRight() { return body; },
      appendParagraph(t) { const p = para(lines); p.text = t; return p; },
      appendTable(rows) {
        rows.forEach(r => lines.push({ text: r.join(' | ') }));
        return { getNumRows: () => rows.length, setBorderWidth() {}, getCell: () => ({ getChild: () => ({ asParagraph: () => para([]) }) }) };
      },
      getChild: () => ({ asParagraph: () => para([]) })
    };
    createdDocs[id] = { title, lines };
    return { getBody: () => body, saveAndClose() {}, getId: () => id, getUrl: () => 'https://docs.google.com/document/d/' + id };
  }
};

// ---------------- تحميل ملفات .gs ----------------
const ctx = vm.createContext({
  console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, SyntaxError, parseInt, parseFloat, isNaN, Infinity, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ({ toast() {} }), getUi: () => null,
    newDataValidation: () => { const v = { requireValueInList(l) { v.list = l; return v; }, setAllowInvalid() { return v; }, build() { return v; } }; return v; } },
  CacheService: { getScriptCache: () => cache }, PropertiesService: { getScriptProperties: () => propsSvc },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities, UrlFetchApp, DriveApp, DocumentApp, HtmlService: {},
  MailApp: { sentMails, sendEmail: m => { sentMails.push(m); }, getRemainingDailyQuota: () => 100 },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) }
});
vm.runInContext(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

/** كل طلب في Apps Script تنفيذ جديد: نمسح الذاكرة المؤقتة داخل التنفيذ (لا الكاش). */
function callApi(req) {
  ['kbData_', 'kbIndex_', 'violations_'].forEach(n => { if (ctx[n]) ctx[n].memo = null; });
  vm.runInContext('STOP_SET_ = null', ctx);
  return JSON.parse(JSON.stringify(ctx.api(req)));
}

// ---------------- الواجهة ----------------
function renderIndex() {
  const read = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  const shim = `<script>
  window.google = { script: { run: (function make(ok, fail) {
    return { withSuccessHandler: f => make(f, fail), withFailureHandler: f => make(ok, f),
      api: req => fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
        .then(r => r.json()).then(d => setTimeout(() => ok && ok(d), ${process.env.LATENCY || 50})).catch(e => fail && fail(e)) };
  })() } };</script>`;
  // دوال استبدال (وليس نصوص) حتى لا تُفسَّر $$ و $' داخل الكود كأنماط استبدال
  return read('Index')
    .replace('<div id="root"></div>', () => '<div id="root"></div>' + shim)
    // في Apps Script يضيفها doGet عبر addMetaTag
    .replace('<meta charset="utf-8">', () => '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
}

if (require.main === module) {
  http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api') {
      let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
        let out;
        try { out = callApi(JSON.parse(b)); } catch (e) { console.error(e); out = { ok: false, error: String(e) }; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      });
      return;
    }
    // نفس doPost في Apps Script (للتطبيق المستقل docs/): نص JSON بدون Content-Type + CORS
    if (req.method === 'POST' && req.url === '/exec') {
      let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
        ['kbData_', 'kbIndex_', 'violations_'].forEach(n => { if (ctx[n]) ctx[n].memo = null; });
        vm.runInContext('STOP_SET_ = null', ctx);
        const out = ctx.doPost({ postData: { contents: b } }).text;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out);
      });
      return;
    }
    // يقدّم مجلد docs كما في GitHub Pages
    if (req.url.startsWith('/docs/')) {
      const f = path.join(__dirname, '..', req.url.split('?')[0].replace(/\/$/, '/index.html'));
      if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      let body = fs.readFileSync(f);
      if (f.endsWith('config.js')) body = "window.FS_API_URL = 'http://127.0.0.1:" + PORT + "/exec';";
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(body);
      return;
    }
    if (req.url === '/__setup') { res.writeHead(200); res.end(ctx.createSetupCode()); return; }
    if (req.url === '/__state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ geminiCalls: geminiCalls.length, lastGemini: geminiCalls.slice(-1)[0], docs: createdDocs })); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderIndex());
  }).listen(PORT, () => console.log('harness on ' + PORT));
}

module.exports = { ctx, callApi, sheets, cacheStore, props, geminiCalls, createdDocs, seed, sentMails };
