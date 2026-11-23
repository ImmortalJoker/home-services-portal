import hashlib
import json
from pathlib import Path
import struct
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    'public/apple-touch-icon.png': 180,
    'public/icons/portal-192.png': 192,
    'public/icons/portal-512.png': 512,
    'public/icons/portal-maskable-512.png': 512,
}


class SelectedArtworkTest(unittest.TestCase):
    def test_selected_first_design_has_traceable_matching_delivery_assets(self):
        draft = ROOT / 'artwork/proposed/portal-source.svg'
        source = ROOT / 'public/icons/portal-source.svg'
        self.assertTrue(source.is_file(), 'Selected detailed portal SVG must be staged as the delivery source')
        # ElementTree discards comments: wording changes must not change the selected geometry.
        self.assertEqual(ET.tostring(ET.fromstring(source.read_bytes())),
                         ET.tostring(ET.fromstring(draft.read_bytes())))
        self.assertEqual(ET.tostring(ET.fromstring((ROOT / 'public/favicon.svg').read_bytes())),
                         ET.tostring(ET.fromstring(source.read_bytes())))
        report = json.loads((ROOT / 'artwork/rendered-assets.json').read_text())
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        self.assertEqual(report['source'], 'public/icons/portal-source.svg')
        self.assertEqual(report['source_sha256'], digest)
        self.assertEqual(set(report['assets']), set(TARGETS))
        for path, size in TARGETS.items():
            data = (ROOT / path).read_bytes()
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual(struct.unpack('>II', data[16:24]), (size, size))
            self.assertEqual(report['assets'][path]['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(report['assets'][path]['width'], size)
            self.assertEqual(report['assets'][path]['height'], size)


if __name__ == '__main__':
    unittest.main()
