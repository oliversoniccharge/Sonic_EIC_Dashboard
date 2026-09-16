import sys
import unittest
import hashlib
import json
import tempfile
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import parse_nem12, parse_nem13, parse_standing
import build_data
import finish_collection
from sync_mail import save_json


def sample(values, quality='A', suffix='E2', interval=30):
    return '100,NEM12,202609010900,WPNTKS,WPNTKS\n200,8000000000,E2,01,' + suffix + ',,DEMO,KWH,' + str(interval) + ',\n300,20260831,' + ','.join(str(v) for v in values) + ',' + quality + ',,,20260901080000,\n900\n'


class MeterTests(unittest.TestCase):
    def test_e2_and_interval_conversion_inputs_preserved(self):
        r = parse_nem12(sample([1.5] * 48))[0]
        self.assertEqual(r['suffix'], 'E2')
        self.assertEqual(sum(r['values']), 72)
        self.assertEqual(r['updated'], '20260901080000')

    def test_missing_is_not_zero(self):
        r = parse_nem12(sample([''] + [0] * 47))[0]
        self.assertIsNone(r['values'][0])
        self.assertEqual(r['values'][1], 0)

    def test_estimated_range(self):
        r = parse_nem12(sample([1] * 48).replace('900', '400,3,5,E,,\n900'))[0]
        self.assertEqual(r['quality'][2:5], ['E'] * 3)
        self.assertEqual(r['quality'][5], 'A')

    def test_bad_rows_rejected(self):
        with self.assertRaises(ValueError):
            parse_nem12(sample([1] * 4))
        with self.assertRaises(ValueError):
            parse_nem12(sample(['nan'] * 48))

    def test_multiple_nmis_stay_separate(self):
        text = sample([1] * 48) + sample([2] * 48).replace('8000000000', '8000000001')
        self.assertEqual({x['nmi'] for x in parse_nem12(text)}, {'8000000000', '8000000001'})

    def test_nem13_consumption_not_daily_demand(self):
        text = '100,NEM13,202608090711,WPNTKS,WPNTKS\n250,8000000000,11,007,11,,DEMO,E,806,20260602000000,A,,,3626,20260727000000,A,,,2820,KWH,20260923,20260727053023,\n900'
        r = parse_nem13(text)[0]
        self.assertEqual(r['consumption'], 2820)
        self.assertEqual(r['start'], '20260602')
        self.assertEqual(r['end'], '20260727')

    def test_standing_data_only_exports_address_fields(self):
        rows = parse_standing('<aseXML><SingleNMIStandingData><NMI>8000000000</NMI><Address><HouseNumber>1</HouseNumber><StreetName>TEST</StreetName><StreetType>RD</StreetType><SuburbOrPlaceOrLocality>Perth</SuburbOrPlaceOrLocality></Address><Password>not-for-export</Password></SingleNMIStandingData></aseXML>')
        self.assertNotIn('Password', str(rows))
        self.assertIn('1 TEST RD', rows[0]['address'])


class PipelineTests(unittest.TestCase):
    def test_revision_order_and_duplicate_content(self):
        with tempfile.TemporaryDirectory(prefix='sonic-eic-test-') as folder:
            root = Path(folder)
            private = root / '.private'
            private.mkdir()
            attachments = {}
            # Older email delivery can carry the newer source revision.
            for i, (value, updated, received) in enumerate([(1, '20260901080000', '2026-09-04'), (2, '20260902080000', '2026-09-03'), (2, '20260902080000', '2026-09-05')]):
                content = sample([value] * 48).replace('20260901080000', updated)
                digest = hashlib.sha256(content.encode()).hexdigest()
                filename = str(i) + '.csv'
                (private / filename).write_text(content)
                attachments[str(i)] = dict(filename=filename, path=filename, received=received, sha256=digest, message_id=str(i))
            save_json(private / 'mail-state.json', {'attachments': attachments})
            with patch.object(build_data, 'ROOT', root), patch.object(build_data, 'PRIVATE', private):
                build_data.build()
                first = json.loads((root / 'dist/data/sites/8000000000.json').read_text())
                build_data.build()
                second = json.loads((root / 'dist/data/sites/8000000000.json').read_text())
            self.assertEqual(first, second)
            self.assertEqual(first['channels'][0]['days']['20260831']['values'], [2] * 48)
            self.assertEqual(len(first['channels'][0]['days']), 1)

    def test_incomplete_collection_does_not_advance_watermark(self):
        with tempfile.TemporaryDirectory(prefix='sonic-eic-test-') as folder:
            private = Path(folder)
            state = {'attachments': {}, 'last_success': '2026-09-01T00:00:00Z'}
            save_json(private / 'mail-state.json', state)
            save_json(private / 'required.json', {'selected_messages': [{'id': 'not-downloaded'}]})
            with patch.object(finish_collection, 'PRIVATE', private):
                with self.assertRaises(RuntimeError):
                    finish_collection.finish('2026-09-02T00:00:00Z', private / 'required.json')
            self.assertEqual(json.loads((private / 'mail-state.json').read_text()), state)

    def test_truncated_file_never_partially_applies(self):
        text = sample([1] * 48) + sample([1] * 2)
        with self.assertRaises(ValueError):
            parse_nem12(text)


if __name__ == '__main__':
    unittest.main()
