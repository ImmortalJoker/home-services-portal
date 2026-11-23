# Portal artwork provenance

This note records how the selected portal icon package is generated. It is a technical provenance record, not a legal opinion or rights clearance.

## Selected design

The owner selected the first, detailed proposal: a portal arch with an inner doorway and four coloured tiles. Its only source is `artwork/proposed/portal-source.svg`, SHA-256 `dd3dca7aa4ded407963d20b6b9ccb6bcba62bc40b38915251c228d0587f4ad41`. Every delivery file, including the favicon, derives from it. The simplified second proposal, `artwork/proposed/favicon.svg`, is not used for delivery. Both draft files stay unchanged, and `tests/lic03_artwork_test.py` pins their bytes.

## Transformation

The delivery SVG is the draft with its first line removed. That line is a comment stating originality and MIT licensing; its trailing newline is removed with it. The wording was provisional pending owner review and was never established, so it is not carried into delivered files. Removing it neither asserts nor waives any rights. Every remaining byte is copied unchanged, including all geometry, colours, and whitespace.

Before copying, the renderer checks the draft hash and the exact comment text. It rejects the result unless it contains only allow-listed SVG elements and attributes: no scripts, event handlers, styles, `href` attributes, or non-local `url()` references. The gradients use local `url(#id)` references only. The `xmlns` namespace URI is an identifier and is never fetched.

## Outputs

| Output | Pixels | Produced from |
| --- | --- | --- |
| `public/icons/portal-source.svg` | vector | Draft with the comment removed |
| `public/favicon.svg` | vector | Byte-identical copy of `public/icons/portal-source.svg` |
| `public/apple-touch-icon.png` | 180 × 180 | Chromium render of `public/icons/portal-source.svg` |
| `public/icons/portal-192.png` | 192 × 192 | Chromium render of `public/icons/portal-source.svg` |
| `public/icons/portal-512.png` | 512 × 512 | Chromium render of `public/icons/portal-source.svg` |
| `public/icons/portal-maskable-512.png` | 512 × 512 | Chromium render of `public/icons/portal-source.svg` |
| `artwork/rendered-assets.json` | — | Report written by the renderer |

The report records the draft and delivery source hashes, each PNG's SHA-256, width, and height, plus the Chromium product, revision, and flags used. It contains no host paths. The files keep the paths already referenced by `public/manifest.webmanifest` and `index.html`, which are unchanged.

## Generate and verify

Run these commands from the repository root with Node 22 or later and an already-installed Chromium:

```sh
BROWSER_BIN=/Applications/Chromium.app/Contents/MacOS/Chromium node scripts/render-portal-artwork.mjs
python3 tests/selected_artwork_test.py -v
python3 tests/lic03_artwork_test.py -v
```

The renderer uses only Node built-ins and the native WebSocket. It installs and downloads nothing. It runs these steps:

1. Checks the Node version, native WebSocket support, and that `BROWSER_BIN` is an absolute path to an executable file.
2. Builds and validates the delivery SVG as described above, then writes `public/icons/portal-source.svg`.
3. Starts a new headless Chromium with a fresh mode-0700 temporary profile and the sandbox left on. Remote debugging is set to 127.0.0.1 on port 0. Background networking, sync, extensions, and component updates are disabled. Host-name lookups resolve to not-found, and a mock keychain is used. No existing browser profile, cookies, or credentials are used.
4. Reads `DevToolsActivePort` from that profile, accepts only a valid port and a `/devtools/browser/<uuid>` path, and connects to `ws://127.0.0.1`.
5. Creates one page. For each target, it sets an exact square viewport at device scale factor 1 and navigates only to the local `file:` URL of the delivery SVG. After the load event, it captures until two consecutive PNG frames are byte-identical.
6. Checks the PNG signature, the IHDR dimensions, and the IEND trailer of each capture.
7. Closes Chromium, stopping only the process it started, and deletes only its own temporary profile.
8. Writes the PNGs, `public/favicon.svg`, and finally the report.

Startup is bounded at 30 s, and each protocol command or awaited event at 15 s. Browser exit is bounded at 10 s, followed by SIGTERM and then SIGKILL.

PNG bytes depend on the Chromium build and platform. Regenerate the PNGs and the report together, and keep them together.

## Concurrent runs

Before writing any output, the renderer exclusively creates `.portal-artwork-render.lock` (mode 0600, containing its PID) at the repository root. It holds the lock through browser shutdown, profile removal, and every SVG, PNG, and report write, then removes it on normal success or error. If the lock already exists, the renderer fails immediately with a lock diagnostic and does not start a browser or touch the other run, its files, or the lock. It never steals, retries, or forces the lock.

Forced termination (for example SIGKILL) can leave the lock behind. To recover, read the PID in `.portal-artwork-render.lock`, confirm with `ps -p <pid>` and a process listing that no renderer for this checkout is still running (PIDs can be reused), and only then delete the lock file by hand. Then rerun the renderer so the PNGs and the report are regenerated together.

## Maskable icon

`portal-maskable-512.png` is the same full-bleed render as `portal-512.png`. Platform masks are expected to crop the outer background and the rounded frame. By arithmetic on the SVG geometry, the arch's farthest painted point is about 188 px from the centre of the 512 viewBox. That is inside the 204.8 px radius of the maskable safe zone. This estimate comes from coordinates only. It is not a pixel inspection, a device test, or maskability acceptance, and correct PNG dimensions do not imply any of those. Inspect the actual crop under circle and rounded-square masks before acceptance.

## Previously published artwork

The origin of the previously published icons is unknown. This change overwrites files at the same public paths in the working tree only. Earlier versions remain in Git history, and copies already deployed, cached, or downloaded are unaffected. This note makes no claim about the origin of those assets or the rights in them. History is not rewritten, and `NOTICE` and `LICENSE` are unchanged.

## Local candidate, not deployment

Running the renderer produces a local delivery candidate on the working branch; it does not deploy, publish or rewrite history. The first design's appearance has been selected by the owner. The parent has actually run the renderer with Chrome/156.0.8078.80, verified all four PNG dimensions and source/output hashes, observed a loopback-only DevTools listener, and confirmed the child browser and temporary profile were removed. The source/output acceptance test and all three draft-package tests pass. Pixel/crop observations and device/PWA acceptance remain distinct, and publication is a separate decision.

## Known item left unchanged

`index.html` also points the Safari `mask-icon` at `favicon.svg`. Safari renders a mask icon as a single-colour silhouette, so this full-bleed design may appear as a solid square there. The reference is unchanged and that rendering has not been checked.
