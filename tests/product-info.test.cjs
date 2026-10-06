const assert = require("node:assert/strict");
const test = require("node:test");
const source = require("../docs/product-info.json");
const { buildProductInfo, compareVersions, previousReleaseHistory, releaseMarkdown } = require("../scripts/prepare-product-info.cjs");

const options = { version: "0.1.22", date: "2026-10-06", isRelease: true };

test("bundles the product guide and stamps the installed release version", () => {
  const info = buildProductInfo(source, options);
  assert.equal(info.features.length, 6);
  assert.equal(new Set(info.features.map((feature) => feature.id)).size, info.features.length);
  for (const feature of info.features) {
    assert.ok(feature.title && feature.icon && feature.items.every((text) => typeof text === "string" && text.trim()));
  }
  assert.equal(info.releases[0].version, "0.1.22");
  assert.equal(info.releases[0].date, "2026-10-06");
  assert.equal(info.releases[0].title, source.upcoming.title);
  assert.equal(info.releases.length, 21);
  assert.equal(source.upcoming.version, undefined);
});

test("preserves previous published versions, deduplicates them and orders versions numerically", () => {
  const previous = { version: "0.1.22", date: "2026-10-06", title: "Previous release", changes: [{ type: "fixed", text: "Previous fix" }] };
  const info = buildProductInfo(source, { ...options, version: "0.1.23", previousReleases: [...source.releases, previous] });
  assert.deepEqual(info.releases.slice(0, 3).map((entry) => entry.version), ["0.1.23", "0.1.22", "0.1.21"]);
  assert.equal(info.releases[1].changes[0].text, "Previous fix");
  assert.equal(new Set(info.releases.map((entry) => entry.version)).size, info.releases.length);
  assert.ok(compareVersions("0.1.10", "0.1.9") > 0);
  const rebuilt = buildProductInfo(source, { ...options, previousReleases: info.releases });
  assert.equal(rebuilt.releases.filter((entry) => entry.version === "0.1.22").length, 1);
  assert.equal(rebuilt.releases.some((entry) => entry.version === "0.1.23"), false);
});

test("labels local builds as development without inventing a release version or date", () => {
  const info = buildProductInfo(source, { version: "0.1.0" });
  assert.equal(info.releases[0].version, "development");
  assert.equal(info.releases[0].date, null);
  assert.equal(info.releases[1].version, "0.1.21");
});

test("rejects incomplete or incorrectly classified release notes", () => {
  assert.throws(() => buildProductInfo({ ...source, upcoming: { title: "Title", changes: [] } }, options));
  assert.throws(() => buildProductInfo({ ...source, upcoming: { title: "Title", changes: [{ type: "unknown", text: "Text" }] } }, options));
  assert.throws(() => buildProductInfo(source, { ...options, version: "next" }));
  assert.throws(() => buildProductInfo(source, { ...options, date: "not-a-date" }));
});

test("generates readable Chinese GitHub release notes from the same data as the timeline", () => {
  const entry = buildProductInfo(source, options).releases[0];
  const markdown = releaseMarkdown(entry);
  assert.match(markdown, /^# ClipPort 0\.1\.22/);
  assert.ok(markdown.includes("2026-10-06"));
  for (const change of entry.changes) assert.ok(markdown.includes(change.text));
  assert.match(markdown, /- 新增：/);
  assert.match(markdown, /- 优化：/);
});

test("reads previous history snapshots without forwarding API credentials to asset downloads", async () => {
  const calls = [];
  const history = { schemaVersion: 1, releases: source.releases };
  const result = await previousReleaseHistory("gaozs1994/clip-port", {
    token: "test-token",
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return calls.length === 1
        ? { ok: true, json: async () => ({ assets: [{ name: "release-notes.json", browser_download_url: "https://github.com/gaozs1994/clip-port/releases/download/build-21/release-notes.json" }] }) }
        : { ok: true, text: async () => JSON.stringify(history) };
    },
  });
  assert.deepEqual(result, source.releases);
  assert.equal(calls[0].request.headers.Authorization, "Bearer test-token");
  assert.equal(calls[1].request.headers, undefined);
});

test("seeds legacy releases that have no history asset, but does not silently lose history on network failures", async () => {
  assert.deepEqual(await previousReleaseHistory("gaozs1994/clip-port", { fetchImpl: async () => ({ status: 404 }) }), []);
  assert.deepEqual(await previousReleaseHistory("gaozs1994/clip-port", { fetchImpl: async () => ({ ok: true, json: async () => ({ assets: [] }) }) }), []);
  await assert.rejects(previousReleaseHistory("gaozs1994/clip-port", { fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  await assert.rejects(previousReleaseHistory("gaozs1994/clip-port", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ assets: [{ name: "release-notes.json", browser_download_url: "https://example.com/release-notes.json" }] }) }),
  }), /Unexpected/);
});
