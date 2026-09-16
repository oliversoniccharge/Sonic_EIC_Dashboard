"""One-time mechanical import of the existing dashboard and supplied brand assets."""
from pathlib import Path
from sync_mail import ROOT

workspace = ROOT.parents[2]
assets = workspace / '04_Marketing/Brand/02. Company Logos'
for source, target in [('Full Logo_White.svg', 'logo-white.svg'), ('Full Logo_Black.svg', 'logo-black.svg'), ('Icon_White.svg', 'brand-icon.svg')]:
    (ROOT / 'dist' / target).write_bytes((assets / source).read_bytes())
source = workspace / '00_AI/tools/Meter Data Analysis/meter-dashboard.html'
html = source.read_text(encoding='utf-8')
import re
# Replace the embedded SES branding with the official Sonic Charge artwork.
html = re.sub(r'src="data:image/png;base64,[^"]+"', 'src="logo-white.svg"', html, count=1)
html = re.sub(r'src="data:image/png;base64,[^"]+"', 'src="logo-black.svg"', html, count=1)
html = html.replace('Sonic Engineering Services', 'Sonic Charge').replace('<title>Meter Data Analysis Dashboard</title>', '<title>Sonic Charge · Detailed meter analysis</title>')
html = html.replace('</head>', '<link rel="icon" href="brand-icon.svg"><style>.header-logo-mark{width:180px;height:65px;object-fit:contain}.header-brand-sub{font-size:12px}body{font-size:16px} .header-title:before{content:""} .site-back{padding:10px 24px;background:#07191d;font-size:14px} .site-back a{color:#03c0c1}</style></head>')
html = html.replace('<body>', '<body><div class="site-back"><a href="./">← All sites</a><span id="hostedAnalysisNotice" style="margin-left:20px"></span></div>')
html = html.replace('</body>', '<script type="module" src="legacy-loader.mjs"></script></body>')
(ROOT / 'dist/analysis.html').write_text(html, encoding='utf-8')
print('Imported original analyser and official Sonic Charge logos')
