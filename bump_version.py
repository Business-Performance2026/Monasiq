# يضيف رقم إصدار لكل ملفات assets حتى يجلب المتصفح النسخة الجديدة بعد كل تحديث
import re, glob, time, sys
V = sys.argv[1] if len(sys.argv) > 1 else time.strftime("%Y%m%d%H%M")
files = glob.glob("*.html") + glob.glob("assets/*.js")
pat_js = re.compile(r'''((?:from|import)\s*\(?\s*["'])(\./(?:assets/)?[\w\-]+\.(?:js|mjs))(\?v=[\w]+)?(["'])''')
pat_html = re.compile(r'''((?:src|href)=["'])(assets/[\w\-]+\.(?:js|css))(\?v=[\w]+)?(["'])''')
for f in files:
    s = open(f, encoding="utf-8").read()
    n = pat_js.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={V}{m.group(4)}", s)
    n = pat_html.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={V}{m.group(4)}", n)
    if n != s: open(f, "w", encoding="utf-8").write(n); print("updated", f)
print("version", V)
