# make-offline.py — builds Laoshi.html, one file with everything inside it
# (styles, code, lesson data, stroke data, icon). It opens by double-clicking,
# with no internet, so it can be copied to a USB stick and used on any computer.
# Run: python3 make-offline.py <output.html>
import base64, json, re, sys
from pathlib import Path

here = Path(__file__).parent
html = (here / 'index.html').read_text()

def js_data(path):
    text = json.dumps(json.loads((here / path).read_text()), ensure_ascii=False, separators=(',', ':'))
    return text.replace('</', '<\\/')

files = ['data/hsk1.json', 'data/extra-questions.json', 'data/radicals.json', 'data/strokes.json']
data_script = '<script>\nwindow.LAOSHI_FILES = {\n' + ',\n'.join(
    f'{json.dumps(f)}: {js_data(f)}' for f in files) + '\n};\n</script>'

icon = 'data:image/png;base64,' + base64.b64encode((here / 'icons/favicon-64.png').read_bytes()).decode()
html = re.sub(r'<link rel="manifest"[^>]*>\n', '', html)
html = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n', '', html)
html = html.replace('href="icons/favicon-64.png"', f'href="{icon}"')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (here / 'style.css').read_text() + '\n</style>')

def inline(m):
    src = m.group(1)
    code = (here / src).read_text()
    tag = '<script>\n' + code + '\n</script>'
    return (data_script + '\n' + tag) if src == 'app.js' else tag

html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
Path(sys.argv[1]).write_text(html)
print('wrote', sys.argv[1], round(len(html.encode()) / 1024), 'KB')
