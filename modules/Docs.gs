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
