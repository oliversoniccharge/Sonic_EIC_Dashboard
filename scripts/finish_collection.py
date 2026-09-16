"""Record a fully checked mailbox window without hiding historical backfill."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from sync_mail import PRIVATE, save_json


def finish(checked_at, required_plan):
    datetime.fromisoformat(checked_at.replace('Z', '+00:00'))
    state_path = PRIVATE / 'mail-state.json'
    state = json.loads(state_path.read_text())
    done = {e['message_id'] for e in state['attachments'].values()}
    required = json.loads(Path(required_plan).read_text())['selected_messages']
    missing = [m['id'] for m in required if m['id'] not in done]
    if missing:
        raise RuntimeError(f'{len(missing)} required messages still need attachments; watermark unchanged')
    backfill_path = PRIVATE / 'backfill-plan.json'
    backfill = json.loads(backfill_path.read_text())['selected_messages'] if backfill_path.exists() else []
    remaining = sum(m['id'] not in done for m in backfill)
    state.update(last_success=checked_at, last_attempt=datetime.now(timezone.utc).isoformat(), errors=[], backfill_remaining=remaining,
                 schedule='Daily at 6:00 am AWST · Western Power email attachments')
    save_json(state_path, state)
    print(json.dumps({'checked': checked_at, 'attachments': len(state['attachments']), 'backfill_remaining': remaining}))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--checked-at', required=True)
    p.add_argument('--required-plan', required=True)
    a = p.parse_args()
    finish(a.checked_at, a.required_plan)
