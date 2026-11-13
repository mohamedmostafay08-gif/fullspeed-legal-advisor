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
