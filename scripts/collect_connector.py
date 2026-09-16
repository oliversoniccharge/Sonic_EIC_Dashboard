"""Materialize exact attachment download URLs supplied by the Outlook connector."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
import requests
from sync_mail import PRIVATE, save_json


def download(entry):
    uri = entry['download_url']
    host = urlparse(uri).hostname or ''
    if urlparse(uri).scheme != 'https' or not host.endswith('.oaiusercontent.com'):
        raise ValueError('Only exact Outlook connector file URLs are accepted')
    r = requests.get(uri, timeout=90)
    r.raise_for_status()
    raw = r.content
    if len(raw) > 25 * 1024 * 1024:
        raise ValueError('File exceeds 25 MB')
    digest = hashlib.sha256(raw).hexdigest()
    name = entry['filename']
    rel = 'inbox/' + digest + Path(name).suffix.lower()
    path = PRIVATE / rel
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_bytes(raw)
    key = hashlib.sha256((entry['message_id'] + ':' + entry['attachment_id']).encode()).hexdigest()
    return key, {k: entry[k] for k in ['filename', 'received', 'subject', 'message_id']} | {'path': rel, 'sha256': digest}


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('manifest')
    args = p.parse_args()
    entries = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    state_path = PRIVATE / 'mail-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'attachments': {}, 'last_success': None}
    count, failures = 0, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(download, e): e for e in entries}
        for f in concurrent.futures.as_completed(futures):
            try:
                key, entry = f.result()
                state['attachments'][key] = entry
                count += 1
            except Exception as exc:
                failures.append({'filename': futures[f]['filename'], 'error': type(exc).__name__})
    # Checkpoints never advance the successful mailbox watermark.
    save_json(state_path, state)
    print(json.dumps({'downloaded': count, 'failed': failures, 'total_saved': len(state['attachments'])}))
    if failures:
        raise SystemExit(1)
