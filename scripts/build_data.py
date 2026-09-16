"""Validate and merge private Western Power attachments into private static assets."""
import csv
import io
import json
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from sync_mail import ROOT, PRIVATE, save_json


def decode(raw):
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return raw.decode('cp1252')


def canonical_nmi(value):
    if not re.fullmatch(r'[A-Za-z0-9]{10,11}', value):
        raise ValueError('Invalid NMI')
    return value[:10]


def parse_nem12(text):
    rows = csv.reader(io.StringIO(text))
    channel, last, created = None, None, ''
    output = []
    for line, f in enumerate(rows, 1):
        if not f:
            continue
        if f[0] == '100':
            if len(f) < 3 or f[1] != 'NEM12':
                raise ValueError('Not a NEM12 file')
            created = f[2]
        elif f[0] == '200':
            if len(f) < 9:
                raise ValueError(f'Incomplete register at line {line}')
            interval = int(f[8])
            if interval not in {1, 5, 10, 15, 20, 30, 60}:
                raise ValueError(f'Unsupported interval {interval}')
            channel = {'nmi': canonical_nmi(f[1]), 'suffix': f[4], 'register': f[3], 'meter': f[6], 'unit': f[7].upper(), 'interval': interval}
            last = None
        elif f[0] == '300':
            if channel is None:
                raise ValueError('Reading has no register')
            count = 1440 // channel['interval']
            if len(f) < count + 3:
                raise ValueError(f'Truncated interval row at line {line}')
            datetime.strptime(f[1], '%Y%m%d')
            values = []
            for v in f[2:2 + count]:
                if not v.strip():
                    values.append(None)
                else:
                    number = float(v)
                    if not math.isfinite(number):
                        raise ValueError('Non-finite meter reading')
                    values.append(number)
            quality = f[2 + count] or '?'
            updated = f[5 + count] if len(f) > 5 + count else ''
            last = channel | {'date': f[1], 'values': values, 'quality': [quality] * count, 'updated': updated, 'created': created}
            output.append(last)
        elif f[0] == '400' and last:
            start, end = int(f[1]), int(f[2])
            if not 1 <= start <= end <= len(last['values']):
                raise ValueError('Invalid quality interval range')
            last['quality'][start - 1:end] = [f[3] or '?'] * (end - start + 1)
    if not output:
        raise ValueError('No interval readings')
    return output


def parse_nem13(text):
    result = []
    for f in csv.reader(io.StringIO(text)):
        if not f or f[0] != '250':
            continue
        if len(f) < 23:
            raise ValueError('Truncated NEM13 record')
        start, end = f[9][:8], f[14][:8]
        datetime.strptime(start, '%Y%m%d'); datetime.strptime(end, '%Y%m%d')
        # NEM13 carries measured consumption for a read period, not interval demand.
        consumption = float(f[18])
        if not math.isfinite(consumption):
            raise ValueError('Non-finite accumulated consumption')
        result.append({'nmi': canonical_nmi(f[1]), 'suffix': f[4], 'register': f[3], 'meter': f[6], 'direction': f[7], 'start': start, 'end': end, 'start_read': f[8], 'end_read': f[13], 'consumption': consumption, 'unit': f[19].upper(), 'quality': f[15], 'updated': f[21]})
    if not result:
        raise ValueError('No NEM13 accumulated readings')
    return result


def parse_standing(text):
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('Unsupported XML declaration')
    root = ET.fromstring(text)
    for node in root.iter():
        node.tag = node.tag.split('}')[-1]
    result = []
    for site in root.findall('.//SingleNMIStandingData'):
        nmi = canonical_nmi(site.findtext('NMI', '').strip())
        address = site.find('.//Address')
        def field(tag):
            return address.findtext('.//' + tag, '').strip() if address is not None else ''
        unit = ' '.join(filter(None, [field('FlatOrUnitType'), field('FlatOrUnitNumber')]))
        street = ' '.join(filter(None, [field('HouseNumber'), field('StreetName'), field('StreetType')]))
        locality = ' '.join(filter(None, [field('SuburbOrPlaceOrLocality'), field('StateOrTerritory'), field('PostCode')]))
        addr = ', '.join(filter(None, [unit, street, locality]))
        result.append({'nmi': nmi, 'address': addr, 'name': street.title() or ('NMI ' + nmi), 'suburb': field('SuburbOrPlaceOrLocality')})
    if not result:
        raise ValueError('No standing-data sites found')
    return result


def files(raw, filename):
    if filename.lower().endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            infos = z.infolist()
            if sum(i.file_size for i in infos) > 100 * 1024 * 1024 or len(infos) > 200:
                raise ValueError('Archive exceeds extraction limits')
            for info in infos:
                if not info.is_dir() and Path(info.filename).suffix.lower() in {'.csv', '.txt', '.xml'}:
                    yield info.filename, z.read(info)
    else:
        yield filename, raw


def build():
    state_path = PRIVATE / 'mail-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'attachments': {}}
    overrides_path = PRIVATE / 'site-names.json'
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    sites, errors, seen = {}, [], set()
    def get_site(nmi):
        return sites.setdefault(nmi, {'nmi': nmi, 'name': 'NMI ' + nmi, 'address': '', 'channels': {}, 'accumulated': {}, 'sources': [], 'standing_rank': ''})
    entries = sorted(state['attachments'].values(), key=lambda e: (e['received'], e['sha256']))
    for entry in entries:
        if entry['sha256'] in seen:
            continue
        seen.add(entry['sha256'])
        try:
            raw = (PRIVATE / entry['path']).read_bytes()
            for filename, content in files(raw, entry['filename']):
                text = decode(content).strip()
                touched = set()
                if text.startswith('100,NEM12,'):
                    # Parse the entire attachment before applying any rows (file-level atomicity).
                    for r in parse_nem12(text):
                        nmi = r['nmi']; s = get_site(nmi); touched.add(nmi)
                        key = '|'.join(str(r[k]) for k in ['meter', 'register', 'suffix', 'unit', 'interval'])
                        ch = s['channels'].setdefault(key, {k: r[k] for k in ['meter', 'register', 'suffix', 'unit', 'interval']} | {'days': {}})
                        rank = [r['updated'], r['created'], entry['received'], entry['sha256']]
                        old = ch['days'].get(r['date'])
                        if old is None or rank > old['_rank']:
                            ch['days'][r['date']] = {'values': r['values'], 'quality': r['quality'], 'updated': r['updated'], '_rank': rank}
                elif text.startswith('100,NEM13,'):
                    for r in parse_nem13(text):
                        s = get_site(r['nmi']); touched.add(r['nmi'])
                        key = '|'.join(r[k] for k in ['meter', 'register', 'suffix', 'start', 'end'])
                        rank = [r['updated'], entry['received']]
                        if key not in s['accumulated'] or rank > s['accumulated'][key]['_rank']:
                            s['accumulated'][key] = r | {'_rank': rank}
                elif text.startswith('<?xml') or '<aseXML' in text or '<ase:aseXML' in text:
                    for info in parse_standing(text):
                        s = get_site(info['nmi']); touched.add(info['nmi'])
                        if entry['received'] >= s['standing_rank']:
                            s.update(info); s['standing_rank'] = entry['received']
                else:
                    raise ValueError('Unsupported file format; retained for review')
                for nmi in touched:
                    get_site(nmi)['sources'].append({'filename': filename, 'received': entry['received'], 'sha256': entry['sha256']})
        except Exception as exc:
            errors.append({'filename': entry['filename'], 'reason': str(exc)})
    catalog = []
    for nmi, s in sorted(sites.items()):
        s.pop('standing_rank', None)
        s['channels'] = list(s['channels'].values())
        s['accumulated'] = list(s['accumulated'].values())
        for ch in s['channels']:
            for row in ch['days'].values():
                row.pop('_rank')
        for row in s['accumulated']:
            row.pop('_rank')
        dates = sorted({d for ch in s['channels'] for d in ch['days']} | {r['end'] for r in s['accumulated']} | {r['start'] for r in s['accumulated']})
        s['first'], s['latest'] = (dates[0], dates[-1]) if dates else (None, None)
        if nmi in overrides:
            s['name'] = overrides[nmi]['name'] if isinstance(overrides[nmi], dict) else overrides[nmi]
        elif s['address']:
            s['name'] = s['name'] + (', ' + s.get('suburb', '').title() if s.get('suburb') else '')
        save_json(ROOT / 'dist/data/sites' / (nmi + '.json'), s)
        catalog.append({k: s[k] for k in ['nmi', 'name', 'address', 'first', 'latest']} | {'registers': len(s['channels']), 'files': len(s['sources']), 'accumulated': len(s['accumulated'])})
    sync = {'lastSuccess': state.get('last_success'), 'lastAttempt': state.get('last_attempt'), 'errors': state.get('errors', []) + errors, 'schedule': state.get('schedule', 'Daily email collection · Australia/Perth'), 'attachments': len(state['attachments']), 'backfillRemaining': state.get('backfill_remaining', 0)}
    catalog.sort(key=lambda s: s['name'].lower())
    save_json(ROOT / 'dist/data/catalog.json', {'generated': datetime.now(timezone.utc).isoformat(), 'sync': sync, 'sites': catalog})
    save_json(PRIVATE / 'build-report.json', {'sites': len(sites), 'unique_files': len(seen), 'errors': errors})
    print(json.dumps({'sites': len(sites), 'unique_files': len(seen), 'errors': errors}))
    if errors:
        raise SystemExit(1)
    # Public source marker only; customer data remains ignored. Each private
    # dataset publish is tied to a distinct, reproducible source revision.
    save_json(ROOT / 'dist/version.json', {'built_at': datetime.now(timezone.utc).isoformat()})


if __name__ == '__main__':
    build()
