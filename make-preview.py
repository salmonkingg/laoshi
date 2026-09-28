# make-preview.py — builds the single-page version used for the claude.ai preview link.
# The preview host wants one page with the styles and scripts inside it, so this
# script copies them in. Run: python3 make-preview.py <output.html>
import re, sys
from pathlib import Path

here = Path(__file__).parent
html = (here / 'index.html').read_text()
head = re.search(r'<head>(.*)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)

keep = [l for l in head.splitlines() if '<title>' in l or 'fonts.g' in l]
css = (here / 'style.css').read_text()

def inline(m):
    src = m.group(1)
    return '<script>\n' + (here / src).read_text() + '\n</script>'

body = re.sub(r'<script src="([^"]+)"></script>', inline, body)
out = '\n'.join(keep) + '\n<style>\n' + css + '\n</style>\n' + body
Path(sys.argv[1]).write_text(out)
print('wrote', sys.argv[1], len(out), 'bytes')
