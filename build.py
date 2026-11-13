#!/usr/bin/env python3
"""يبني ملفات البرنامج من المصدر المقسّم في modules/ — شغّله بعد أي تعديل:

    python build.py

الناتج:
  apps-script/Code.gs     ← يُلصق في محرر Apps Script
  apps-script/Index.html  ← يُلصق في ملف Index في محرر Apps Script
  docs/index.html         ← التطبيق المستقل على GitHub Pages (يكلم السيرفر عن طريق doPost)
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MOD = ROOT / "modules"
GS_ORDER = ["Code", "Store", "Auth", "KbDict", "Kb", "Penalties", "Calc", "Docs", "Ai", "Manage"]

HEADER = """/**
 * ============================================================================
 *  المستشار القانوني — Full Speed
 *  ملف الكود الكامل (Code.gs). الملف الثاني هو Index.html.
 *  لا تعدّل هذا الملف يدوياً؛ هو ناتج دمج ملفات المجلد modules (python build.py).
 *  Powered by Mohamed Mostafa — 01120339097
 * ============================================================================
 */
"""

WEB_HEAD = """<link rel="manifest" href="manifest.webmanifest">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="المستشار القانوني">
  <title>المستشار القانوني | Full Speed</title>
  <link rel="icon" href="icons/icon-192.png">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <script src="config.js"></script>"""


def main():
    parts = [HEADER]
    for name in GS_ORDER:
        body = (MOD / f"{name}.gs").read_text(encoding="utf-8")
        parts.append(f"\n// ############################################################################\n"
                     f"// ## {name}\n// ############################################################################\n\n{body}")
    code = "\n".join(parts)
    (ROOT / "apps-script" / "Code.gs").write_text(code, encoding="utf-8")

    index = (MOD / "Index.html").read_text(encoding="utf-8")
    index = index.replace("<?!= include('Styles'); ?>", (MOD / "Styles.html").read_text(encoding="utf-8").strip())
    index = index.replace("<?!= include('Client'); ?>", (MOD / "Client.html").read_text(encoding="utf-8").strip())
    assert "<?" not in index, "بقي وسم قالب في Index.html"
    assert "<!--WEB_HEAD-->" in index
    (ROOT / "apps-script" / "Index.html").write_text(index, encoding="utf-8")

    web = index.replace("<!--WEB_HEAD-->", WEB_HEAD).replace('<base target="_top">\n', "")
    (ROOT / "docs" / "index.html").write_text(web, encoding="utf-8")
    print(f"Code.gs: {len(code):,} | Index.html: {len(index):,} | docs/index.html built")


if __name__ == "__main__":
    main()
