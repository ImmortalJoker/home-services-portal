import hashlib
import os
from pathlib import Path
import subprocess
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DRAFT = ROOT / "artwork" / "proposed"
SOURCES = {
    "favicon.svg": "e1f799efa594b2af004d7d89948cbcb0e967d1bd0cd3013bbe42bffd47460df8",
    "portal-source.svg": "dd3dca7aa4ded407963d20b6b9ccb6bcba62bc40b38915251c228d0587f4ad41",
}
# Delivery-candidate scope (docs/artwork-provenance.md): the selected first design may
# be staged at these public paths only. Every other path under public/, plus NOTICE
# and LICENSE, must still match the checkout HEAD.
DELIVERY_OUTPUTS = frozenset({
    "public/favicon.svg",
    "public/apple-touch-icon.png",
    "public/icons/portal-source.svg",
    "public/icons/portal-192.png",
    "public/icons/portal-512.png",
    "public/icons/portal-maskable-512.png",
})
HTML_ATTRIBUTES = {
    "html": {"lang"},
    "meta": {"charset", "name", "content"},
    "a": {"href"},
    "img": {"src", "alt", "width", "height"},
    **dict.fromkeys(
        ("head", "title", "body", "h1", "h2", "p", "section", "figure", "figcaption"),
        set(),
    ),
}


class DraftArtworkTest(unittest.TestCase):
    def test_svg_sources_match_supplied_bytes(self):
        # Pin the reviewed input, including its local-only gradient references.
        # Any change, including adding a resource reference, fails this check.
        for name, digest in SOURCES.items():
            with self.subTest(source=name):
                self.assertEqual(hashlib.sha256((DRAFT / name).read_bytes()).hexdigest(), digest)

    def test_preview_uses_only_local_draft_sources_at_all_review_sizes(self):
        preview = (DRAFT / "preview.html").read_text(encoding="utf-8")
        doctype = "<!doctype html>\n"
        self.assertTrue(preview.startswith(doctype))
        markup = preview[len(doctype):]
        self.assertNotIn("<!", markup)
        self.assertNotIn("<?", markup)
        page = ET.fromstring(markup)
        self.assertIn("Unpublished proposal", page.findtext("./body/h1"))

        for element in page.iter():
            self.assertIn(element.tag, HTML_ATTRIBUTES)
            self.assertLessEqual(set(element.attrib), HTML_ATTRIBUTES[element.tag])
            if element.tag == "meta":
                self.assertIn(element.attrib, (
                    {"charset": "utf-8"},
                    {"name": "viewport", "content": "width=device-width, initial-scale=1"},
                ))
            if element.tag in {"a", "img"}:
                attribute = "href" if element.tag == "a" else "src"
                self.assertIn(element.get(attribute), SOURCES)

        sections = page.findall("./body/section")
        self.assertCountEqual([section.findtext("./h2/a") for section in sections], SOURCES.keys())
        self.assertEqual(len(page.findall(".//img")), 8)
        for section in sections:
            link = section.find("./h2/a")
            self.assertEqual(link.get("href"), link.text)
            sizes = []
            for figure in section.findall("./figure"):
                sample = figure.find("img")
                self.assertEqual(sample.get("src"), link.text)
                size = sample.get("width")
                self.assertEqual(sample.get("height"), size)
                self.assertTrue(figure.findtext("figcaption").endswith(f"{size} × {size}"))
                sizes.append(size)
            self.assertCountEqual(sizes, ["16", "32", "192", "512"])

    def test_public_changes_limited_to_selected_icon_outputs(self):
        git = os.environ.get("LIC03_GIT", "git")
        paths = ["--", "public", "NOTICE", "LICENSE"]

        def run(*args):
            return subprocess.run(
                [git, *args, *paths], cwd=ROOT, text=True, capture_output=True, check=True
            ).stdout

        changes = {}
        for line in run("diff", "HEAD", "--no-renames", "--name-status").splitlines():
            status, _, name = line.partition("\t")
            changes[name] = status
        for name in run("ls-files", "--others").splitlines():
            changes[name] = "untracked"
        for name, status in sorted(changes.items()):
            with self.subTest(path=name, status=status):
                # NOTICE, LICENSE and every other public path are outside the allowed set.
                self.assertIn(name, DELIVERY_OUTPUTS)
                # Delivery outputs may be added or updated, never deleted or retyped.
                self.assertIn(status, {"M", "A", "untracked"})


if __name__ == "__main__":
    unittest.main()
