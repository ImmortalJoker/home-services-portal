"""Serialization regression only: the fake browser never generates PNGs."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RendererConcurrencyTest(unittest.TestCase):
    def test_second_run_cannot_start_browser_or_replace_first_run_source(self):
        node = os.environ.get('LIC03_NODE', 'node')
        with tempfile.TemporaryDirectory(prefix='lic03-lock-test-') as directory:
            work = Path(directory)
            for name in ('scripts', 'artwork/proposed', 'tmp'):
                (work / name).mkdir(parents=True)
            shutil.copy2(ROOT / 'scripts/render-portal-artwork.mjs', work / 'scripts')
            shutil.copy2(ROOT / 'artwork/proposed/portal-source.svg', work / 'artwork/proposed')
            marker = work / 'browser-starts.txt'
            fake = work / 'fake-browser'
            fake.write_text('#!/bin/sh\nprintf start\\n >> "' + str(marker) + '"\nsleep 60\n')
            fake.chmod(0o700)
            env = {'PATH': '/usr/bin:/bin', 'HOME': str(work),
                   'TMPDIR': str(work / 'tmp'), 'BROWSER_BIN': str(fake)}
            command = [node, 'scripts/render-portal-artwork.mjs']
            jobs = []
            try:
                first = subprocess.Popen(command, cwd=work, env=env, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, start_new_session=True)
                jobs.append(first)
                deadline = time.monotonic() + 8
                while not marker.exists() and first.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(marker.exists(), 'First renderer must enter the controlled browser wait')
                source = work / 'public/icons/portal-source.svg'
                self.assertEqual((work / '.portal-artwork-render.lock').read_text(), f'{first.pid}\n')
                original = (source.read_bytes(), source.stat().st_mtime_ns)
                second = subprocess.Popen(command, cwd=work, env=env, stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE, start_new_session=True)
                jobs.append(second)
                try:
                    _, error = second.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    self.fail('Overlapping renderer was not rejected before starting another browser')
                self.assertNotEqual(second.returncode, 0)
                self.assertIn(b'lock', error.lower())
                self.assertEqual(marker.read_bytes().count(b'start'), 1)
                self.assertEqual((source.read_bytes(), source.stat().st_mtime_ns), original)
                self.assertIsNone(first.poll(), 'Second run must not stop the owner of the lock')
            finally:
                for job in jobs:
                    try:
                        os.killpg(job.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                for job in jobs:
                    job.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
