"""Windows adapter around the installed Sites packaging helper."""
import argparse
import os
import subprocess
from pathlib import Path
from sync_mail import ROOT

p = argparse.ArgumentParser()
p.add_argument('plugin_root', type=Path)
p.add_argument('archive', type=Path)
a = p.parse_args()
archive = a.archive.resolve()
env = dict(os.environ)
env['PATH'] = r'C:\Program Files\Git\bin;' + env['PATH']
# GNU tar otherwise treats the drive colon as a remote-host separator.
posix_archive = '/' + archive.drive[0].lower() + archive.as_posix()[2:]
subprocess.run(['node', str(a.plugin_root / 'scripts/package-site.mjs'), str(ROOT), posix_archive],
               env=env, cwd=ROOT, check=True)
