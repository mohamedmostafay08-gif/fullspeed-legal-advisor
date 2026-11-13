"""يبني ملف البيانات FullSpeed_Legal_Data.xlsx من قاعدة المعرفة المجهزة في النسخة الأولى.

الاستخدام:
    python tools/build_workbook.py <مجلد data في النسخة الأولى> <ملف الإخراج>

يُرفع الملف الناتج إلى Google Drive ويُفتح كـ Google Sheets، ثم يُضاف إليه كود Apps Script.
يُخرج أيضاً نسخة JSON من نفس البيانات تستخدمها أداة الاختبار المحلية.
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

PEN_CODES = {
    "W": "إنذار كتابي", "Q": "خصم ربع يوم", "H": "خصم نصف يوم", "1": "خصم يوم", "2": "خصم يومين",
    "3": "خصم ثلاثة أيام", "4": "خصم أربعة أيام", "5": "خصم خمسة أيام",
    "R": "الحرمان من نصف العلاوة", "D": "الخفض إلى الوظيفة الأدنى مباشرة",
    "F": "الإحالة إلى المحكمة العمالية للفصل من العمل", "A": "يعتبر غائباً (يُطبق جزاء الغياب)",
}
PEN_SECTIONS = [
    "أولاً: مخالفات تتعلق بمواعيد العمل",
    "ثانياً: مخالفات تتعلق بنظام العمل والانضباط الوظيفي",
    "ثالثاً: (عنوان القسم في الصفحات الناقصة من الملف)",
    "رابعاً: مخالفات تتعلق بالتحول الرقمي وأمن المعلومات",
    "خامساً: مخالفات تتعلق بأحكام السلامة والصحة المهنية وتأمين بيئة العمل",
]
SHEETS = {
    "Sources": ["id", "title", "short", "citation", "pdf", "notes"],
    "Articles": ["source", "num", "label", "chapter", "page", "also_contains", "text"],
    "Penalties": ["num", "section", "text", "case_label", "first", "second", "third", "fourth", "uncertain", "page", "manual", "entered_by", "entered_at"],
    "Users": ["username", "full_name", "role", "salt", "hash", "active", "created_at", "last_login"],
    "Questions": ["id", "time", "username", "mode", "question", "provider", "model", "answer_json", "verification_json", "feedback", "feedback_note", "redactions"],
    "Documents": ["time", "username", "doc_type", "employee", "doc_url", "pdf_url"],
    "Settings": ["key", "value"],
}
ORDER = ["labor14", "workreg", "penreg", "ins148", "tax151"]
HEAD_FILL = PatternFill("solid", fgColor="0B2545")


def build(data_dir: Path):
    rows = {k: [] for k in SHEETS}
    for sid in ORDER:
        src = json.loads((data_dir / "sources" / f"{sid}.json").read_text(encoding="utf-8"))
        notes = src.get("notes", "")
        if sid == "penreg":
            notes = ("جدول المخالفات والحد الأقصى للجزاء لأول مرة وحالات العود، منسوخ من صور الجدول وروجعت الخلايا الباهتة بعد تحسين الصورة. "
                     "الجزاءات المذكورة حد أقصى، ويجوز توقيع جزاء أخف. المخالفات 62 إلى 77 ناقصة من الملف المرفوع وتُدخل من صفحة الإدارة أو من جدول Penalties.")
        rows["Sources"].append([sid, src["title"], src["short"], src["citation"], src.get("pdf", ""), notes])
        if sid == "penreg":
            continue  # مواد لائحة الجزاءات تُبنى من جدول Penalties
        for a in src["articles"]:
            rows["Articles"].append([sid, a["num"], a["label"], a.get("chapter", ""), a.get("page") or "",
                                     ",".join(a.get("also_contains", [])), a["text"]])
    pens = json.loads((data_dir / "penalties.json").read_text(encoding="utf-8"))
    custom = data_dir / "penalties_custom.json"
    if custom.exists():
        for num, v in json.loads(custom.read_text(encoding="utf-8")).items():
            pens = [p for p in pens if p["num"] != int(num)] + [v]
    pens.sort(key=lambda v: v["num"])
    for v in pens:
        for case in v["cases"]:
            ps = case["penalties"]
            unc = ",".join(str(i + 1) for i, p in enumerate(ps) if p.get("uncertain"))
            rows["Penalties"].append([v["num"], v["section"], v["text"], case["label"]] + [PEN_CODES[p["code"]] for p in ps] +
                                     [unc, v.get("page") or "", bool(v.get("manual")), v.get("entered_by", ""), v.get("entered_at", "")])
    rows["Settings"] += [["company_name", "Full Speed"], ["gemini_model", "gemini-3.5-flash-lite"]]
    return rows


import re
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def clean_rows(rows):
    """إزالة حروف التحكم غير المرئية (مثل فاصل الصفحات) التي لا تقبلها جداول البيانات."""
    return {k: [[_CTRL.sub("\n", c) if isinstance(c, str) else c for c in r] for r in v] for k, v in rows.items()}


def write_xlsx(rows, out: Path):
    wb = Workbook()
    wb.remove(wb.active)
    for name, head in SHEETS.items():
        ws = wb.create_sheet(name)
        ws.sheet_view.rightToLeft = True
        ws.append(head)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = HEAD_FILL
        for r in rows[name]:
            ws.append(r)
        ws.freeze_panes = "A2"
        for col in ws.columns:
            letter = col[0].column_letter
            ws.column_dimensions[letter].width = 18
        if name in ("Articles", "Penalties"):
            text_col = "G" if name == "Articles" else "C"
            ws.column_dimensions[text_col].width = 80
            for cell in ws[text_col][1:]:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
    # قوائم منسدلة في جدول الجزاءات لتسهيل إدخال المخالفات الناقصة
    lists = wb.create_sheet("Lists")
    for i, v in enumerate(PEN_CODES.values(), start=1):
        lists.cell(row=i, column=1, value=v)
    for i, s in enumerate(PEN_SECTIONS, start=1):
        lists.cell(row=i, column=2, value=s)
    lists.sheet_state = "hidden"
    pen = wb["Penalties"]
    dv_pen = DataValidation(type="list", formula1=f"=Lists!$A$1:$A${len(PEN_CODES)}", allow_blank=True)
    dv_sec = DataValidation(type="list", formula1=f"=Lists!$B$1:$B${len(PEN_SECTIONS)}", allow_blank=True)
    pen.add_data_validation(dv_pen)
    pen.add_data_validation(dv_sec)
    dv_pen.add("E2:H400")
    dv_sec.add("B2:B400")
    wb.save(out)


if __name__ == "__main__":
    data_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    rows = clean_rows(build(data_dir))
    write_xlsx(rows, out)
    (out.with_suffix(".json")).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print({k: len(v) for k, v in rows.items()})
