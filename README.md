# Access Receipt

Dated accessibility evidence for public websites. Inspect axe-core findings, import your own reports, compare compatible captures and export JSON or CSV. [Open the tool](https://coolcode.ca/accessreceipt/).

<!-- coolcode:guide -->
Start with the latest published capture or import a standard axe-core JSON report. Select an earlier capture and open **Changes** to see newly observed and no-longer-observed rule/element pairs. Comparisons require the same URL, final URL, axe version, browser, viewport, rule tags and settle time. A failed or missing page is unassessed. Raw axe imports without the full capture profile can be inspected but cannot establish changes. **Needs review** is separate from confirmed automated findings. There is no accessibility grade or conformance certificate. To expand the collection, edit the `pages` array in `web/config.json`, or run the GitHub workflow with comma-separated public URLs you are authorized to check. Imports stay in this tab; download a receipt to keep it.
<!-- /coolcode:guide -->

## What it does

- A weekly GitHub Actions check (Tuesdays, 07:39 UTC), every `main` push, and manual runs capture a configurable set of public rendered pages.
- The collector uses pinned axe-core and Chromium through Playwright. It checks WCAG A/AA tags through WCAG 2.2 plus separately tagged best practices.
- Each successful run adds a timestamped JSON file under `web/data/captures/` and updates the capture index. Git retains earlier versions; the index shows the most recent 104 captures by default. Older files are retained, not deleted.
- A completely failed collection leaves the prior data and deployment unchanged. Partial captures explicitly record unsuccessful pages. Comparisons only cover pages successfully assessed at the same requested/final URL in both runs.
- Public visitors can inspect published reports and import their own standard axe-core JSON or Access Receipt JSON, without accounts or a backend.
- CSV exports the currently filtered view. JSON exports the entire selected receipt after normalization.

## Add or change pages

Edit [`web/config.json`](web/config.json):

```json
{
  "pages": [
    {"url": "https://coolcode.ca/", "label": "CoolCode catalogue"},
    {"url": "https://liminalhacker.com/", "label": "Liminal Hacker"},
    {"url": "https://nethush.com/", "label": "NetHush"}
  ],
  "viewport": {"width": 1280, "height": 900},
  "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
  "settleMilliseconds": 1500,
  "navigationTimeoutMilliseconds": 25000,
  "maxPagesPerRun": 20,
  "maxNetworkRequestsPerPage": 600,
  "historyLimit": 104
}
```

The starting list is three CoolCode pages, not an allowlist. Add your own sites and any public page you are authorized to check. Up to 20 pages per run, HTTP(S) on standard ports. To run a one-off collection, open **Actions → Access Receipt · Check, capture and publish → Run workflow**, and enter comma-separated URLs in `urls`. Leave it empty to use the saved config. A one-off capture does not change the weekly page list.

No API key is required. Enable GitHub Pages with **GitHub Actions** as the source and permit the workflow to write repository contents so it can retain captures. The first main push performs a genuine collection before publishing. No example findings are presented as collected results.

Changing the viewport, rule tags, browser/axe version, request budget or settle time starts a new comparison profile. Prior receipts remain readable. Choose a matching earlier capture to establish changes. A changed CSS selector can look like one resolved and one introduced finding even when the underlying problem is similar; inspect the evidence.

## Reading the evidence

A *finding location* is a unique `(requested URL, rule ID, element target)` tuple. One rule can affect many elements. Impact levels come from axe-core and are not a legal assessment. Best-practice findings are not necessarily WCAG failures. Rule guidance links explain each test.

*Needs review* is axe's `incomplete` category, where a human must decide. If a previously failing target becomes incomplete, the comparison says **Now needs review**, not resolved. An earlier finding absent from a comparable scan is **No longer observed**; this could reflect changed content or selectors, not necessarily a fix. Failed checks, removed pages and changed redirects never imply resolution.

The run captures the document after DOM content loads and a short configurable settle time. It does not sign in, submit forms, expand every menu, test every route, or replace keyboard/screen-reader testing. Dynamic API data, fonts, asynchronous content, or animations can affect results. Read-only request restrictions can prevent pages relying on POST APIs from fully rendering. Test those applications in your own appropriate environment and import their axe report. The inspection browser bypasses page CSP only to inject the local axe engine; this tool does not assess a site's content-security policy. A published capture is limited to 8 MB, matching the import limit; use smaller page groups if needed.

Raw axe JSON has useful findings but does not reliably record the viewport, exact page state or full capture profile. It is displayed without making introduced/resolved claims. To compare reports produced by another collector, provide the documented Access Receipt format and matching profile rather than inventing missing metadata.

## Privacy and network policy

Published captures retain rule ID, help/description, impact, tags, element selectors, page URLs, dates, aggregate passed/inapplicable rule counts and request/error counts. The page list flags blocked requests or failed/HTTP-error responses, which may mean some content did not load. These counters can overlap. Captures deliberately omit raw DOM HTML, axe check data, form values, browser traces and screenshots. Public CSS selectors and URLs can still identify elements: only configure public pages whose recorded evidence you intend to publish. Do not include private query strings, credentials or tokens.

The collector uses a local egress proxy that resolves each destination and connects to the checked public IP, including HTTPS CONNECT tunnels. Private, loopback, link-local, multicast and reserved addresses are rejected. It does not perform a second DNS resolution when opening the socket. Browser requests are limited to HTTP(S) GET/HEAD, service workers and WebSockets are disabled, redirects and request counts are bounded, and each page uses a fresh browser context. There are no custom auth headers or stored cookies. HTTP errors and challenges remain errors; the collector does not bypass them.

Imports are processed locally, without uploading their contents or persisting them in browser storage. Closing/reloading the page clears imported reports. Importing a report does not fetch its page URL. Explicit source/guidance links and the owner workflow open external pages. The standard CoolCode visit counter records aggregate tool visits; it receives no report contents.

## Development and checks

```sh
npm ci --ignore-scripts
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

The default build is offline. Source is in `web/`; generated `dist/` is not committed. The CI workflow installs Chromium, runs collection on main/schedule/manual events, builds, then runs `node tests/browser_smoke.mjs` for desktop/mobile UI and import/comparison checks. Browser test fixtures are synthetic and intercepted only in tests, never published as evidence. PR checks do not collect public pages or commit data.

To run the collector in your own authorized CI environment: install Chromium with `npx playwright install --with-deps chromium`, then `node scripts/collect.mjs`. Optional `ACCESSRECEIPT_URLS` overrides the configured URLs for that run. A failed refresh cannot erase last-good captures. Existing deployment remains unchanged if validation/browser checks fail.

## Sources and licensing

- [axe-core API documentation](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md) — automated test results and rule tags.
- [axe-core MPL 2.0 license](https://github.com/dequelabs/axe-core/blob/develop/LICENSE). The unmodified engine is installed from npm and injected into the CI browser; it is not bundled into the public site. Keep its license with any redistributed engine copy.
- [Playwright documentation](https://playwright.dev/docs/intro) — browser automation.
- [W3C evaluation guidance](https://www.w3.org/WAI/test-evaluate/) — automated tools are one part of accessibility evaluation.

Provider versions are pinned in `package-lock.json`. No paid service, external scanning account or secret is required.
