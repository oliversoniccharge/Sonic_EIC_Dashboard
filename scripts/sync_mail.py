"""Read-only Western Power attachment collector. Credentials stay on this machine."""
import argparse
import base64
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import requests

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.private'
GRAPH = 'https://graph.microsoft.com/v1.0'


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    temp.replace(path)


def token(auth_dir):
    import msal
    from dotenv import dotenv_values
    settings = dotenv_values(auth_dir / '.env')
    cache = msal.SerializableTokenCache()
    cache_path = auth_dir / '.token_cache'
    if not cache_path.exists():
        raise RuntimeError('Microsoft sign-in is required in the existing email organiser.')
    cache.deserialize(cache_path.read_text(encoding='utf-8'))
    app = msal.PublicClientApplication(settings['AZURE_CLIENT_ID'], authority='https://login.microsoftonline.com/' + settings['AZURE_TENANT_ID'], token_cache=cache)
    accounts = app.get_accounts(username=settings['USER_EMAIL'])
    # Reuse the existing grant without requesting new permissions or opening login UI.
    result = app.acquire_token_silent(['Mail.Read', 'Mail.ReadWrite', 'Files.ReadWrite', 'User.Read'], account=accounts[0]) if accounts else None
    if cache.has_state_changed:
        cache_path.write_text(cache.serialize(), encoding='utf-8')
    if not result or 'access_token' not in result:
        raise RuntimeError('Microsoft sign-in has expired. Reconnect the existing email organiser; no watermark was advanced.')
    return result['access_token']


def get(session, url, params=None):
    if urlparse(url).hostname != 'graph.microsoft.com':
        raise RuntimeError('Unexpected Microsoft pagination host')
    for attempt in range(5):
        r = session.get(url, params=params, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(int(r.headers.get('Retry-After', 2 ** attempt)), 30))
            continue
        if not r.ok:
            raise RuntimeError(f'Microsoft Graph returned HTTP {r.status_code}; sync not completed')
        return r
    raise RuntimeError('Microsoft Graph remained unavailable after retries')


def pages(session, url, params=None):
    while url:
        payload = get(session, url, params).json()
        yield from payload.get('value', [])
        url, params = payload.get('@odata.nextLink'), None


def sync(args):
    PRIVATE.mkdir(exist_ok=True)
    state_path = PRIVATE / 'mail-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'attachments': {}, 'last_success': None}
    started = datetime.now(timezone.utc)
    since = (datetime.fromisoformat(state['last_success']) - timedelta(days=14)).isoformat() if state.get('last_success') and not args.full else '2000-01-01T00:00:00Z'
    auth_dir = Path(args.auth_dir) if args.auth_dir else ROOT.parents[2] / '00_AI/agents/email_organiser'
    session = requests.Session()
    session.headers.update({'Authorization': 'Bearer ' + token(auth_dir), 'Prefer': 'IdType="ImmutableId"'})
    if args.check_auth:
        get(session, GRAPH + '/me', {'$select': 'id'})
        print('Existing Microsoft authentication verified')
        return
    errors, added, messages = [], 0, 0
    # Exact verified meter-data sender; all mail folders, not only Inbox.
    params = {'$filter': f"from/emailAddress/address eq 'edaas_app@westernpower.com.au' and hasAttachments eq true and receivedDateTime ge {since}", '$select': 'id,subject,from,receivedDateTime', '$top': '100'}
    try:
        for message in pages(session, GRAPH + '/me/messages', params):
            messages += 1
            sender = message.get('from', {}).get('emailAddress', {}).get('address', '').lower()
            if sender != 'edaas_app@westernpower.com.au':
                continue
            mid = quote(message['id'], safe='')
            attachments = pages(session, GRAPH + f'/me/messages/{mid}/attachments', {'$select': 'id,name,size,isInline,contentType'})
            for a in attachments:
                key = hashlib.sha256((message['id'] + ':' + a['id']).encode()).hexdigest()
                if key in state['attachments'] and (PRIVATE / state['attachments'][key]['path']).exists():
                    continue
                name = a.get('name', '')
                if a.get('isInline') or Path(name).suffix.lower() not in {'.csv', '.txt', '.zip', '.xls', '.xlsx'}:
                    continue
                if a.get('size', 0) > 25 * 1024 * 1024:
                    errors.append({'attachment': name, 'error': 'Attachment exceeds 25 MB limit'})
                    continue
                try:
                    content = get(session, GRAPH + f'/me/messages/{mid}/attachments/{quote(a["id"], safe="")}/$value').content
                    if len(content) > 25 * 1024 * 1024:
                        raise ValueError('Attachment exceeds size limit')
                    digest = hashlib.sha256(content).hexdigest()
                    rel = 'inbox/' + digest + Path(name).suffix.lower()
                    target = PRIVATE / rel
                    target.parent.mkdir(exist_ok=True)
                    target.write_bytes(content)
                    state['attachments'][key] = {'path': rel, 'filename': name, 'sha256': digest, 'received': message['receivedDateTime'], 'subject': message['subject'], 'message_id': message['id']}
                    added += 1
                except Exception as exc:
                    errors.append({'attachment': name, 'error': str(exc)})
            # Safe progress checkpoint; successful watermark is unchanged until all pages finish.
            save_json(state_path, state)
    except Exception as exc:
        errors.append({'error': str(exc)})
    state['last_attempt'] = started.isoformat()
    state['errors'] = errors
    state['messages_checked'] = messages
    state['new_attachments'] = added
    if not errors:
        state['last_success'] = started.isoformat()
    save_json(state_path, state)
    print(json.dumps({'status': 'failed' if errors else 'success', 'messages_checked': messages, 'new_attachments': added, 'total_attachments': len(state['attachments']), 'errors': errors}))
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--auth-dir')
    p.add_argument('--full', action='store_true')
    p.add_argument('--check-auth', action='store_true')
    try:
        sync(p.parse_args())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
