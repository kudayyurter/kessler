import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

// web/package.json has "type": "module", so Playwright loads this spec as ESM and __dirname is
// not defined; build the fixtures path from import.meta.url instead (Node >= 20.11 also exposes
// import.meta.dirname directly, which is what this resolves to).
const dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(path.join(dirname, "../tests/fixtures", name));

// The LEO fixture snapshot with its records' NORAD IDs rewritten (records start after the JSON
// header; each is 88 bytes with the NORAD ID as a little-endian uint32 at offset 0).
function snapshotWithIds(ids: number[]): Buffer {
  const raw = zlib.gunzipSync(fx("snapshot-leo.bin.gz"));
  const start = 8 + raw.readUInt32LE(4);
  ids.forEach((id, i) => raw.writeUInt32LE(id, start + i * 88));
  return zlib.gzipSync(raw);
}

// The fixture /meta lists only US and PRC; tests of the owner picker add a few more owners.
function metaWithOwners(): string {
  const meta = JSON.parse(fx("api/meta.json").toString());
  meta.owners.push(
    { code: "GER", name: "Germany", flag_emoji: "🇩🇪", in_orbit: 102, total: 110 },
    { code: "FGER", name: "France/Germany", flag_emoji: null, in_orbit: 2, total: 2 },
  );
  return JSON.stringify(meta);
}

// A long enough owner list that the "A–Z" run overflows the picker's max-h-64 list — needed to
// actually exercise "scroll the active option into view", which a handful of owners wouldn't.
function metaWithManyOwners(): string {
  const meta = JSON.parse(fx("api/meta.json").toString());
  for (let i = 0; i < 24; i++) {
    meta.owners.push({ code: `X${i}`, name: `Zzz Owner ${String(i).padStart(2, "0")}`, flag_emoji: null, in_orbit: 0, total: 0 });
  }
  return JSON.stringify(meta);
}

// A single owner with a 50-character name, for the summary pill's truncation/overflow test.
function metaWithLongOwnerName(): string {
  const meta = JSON.parse(fx("api/meta.json").toString());
  meta.owners.push({ code: "LONG", name: "Z".repeat(50), flag_emoji: null, in_orbit: 5, total: 5 });
  return JSON.stringify(meta);
}

// Builds a LEO snapshot fixture for a second generation: same records, a different publish time
// in its header. Same length in, same length out keeps the header's byte-length field and record
// alignment valid, so this is a plain byte-level patch, not a re-encode. Used by the swap test
// below, which otherwise can't tell "the new generation's snapshot arrived" from "the old one's
// did again" — the mocked API serves the same fixture bytes for every generation.
function withPublishTime(gz: Buffer, oldIso: string, newIso: string): Buffer {
  if (newIso.length !== oldIso.length) throw new Error("replacement publish time must be the same length");
  const raw = zlib.gunzipSync(gz);
  const oldBytes = Buffer.from(oldIso, "utf-8");
  const at = raw.indexOf(oldBytes);
  if (at === -1) throw new Error("publish time not found in fixture header");
  const patched = Buffer.from(raw);
  Buffer.from(newIso, "utf-8").copy(patched, at);
  return zlib.gzipSync(patched);
}

async function mockApi(page: Page, overrides: Record<string, { status: number; body?: Buffer | string }> = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const o = Object.entries(overrides).find(([prefix]) => path.startsWith(prefix));
    if (o) return route.fulfill({ status: o[1].status, body: o[1].body ?? JSON.stringify({ error: { code: "x", message: "x" } }), contentType: "application/json" });
    const map: Record<string, string> = {
      "/meta": "api/meta.json", "/stats/timeseries": "api/timeseries.json", "/stats/breakdown": "api/breakdown.json",
      "/events": "api/events.json", "/objects/search": "api/search.json", "/objects/25544": "api/object.json",
      "/globe/current": "api/current.json",
    };
    if (path === "/globe/snapshot") {
      return url.searchParams.get("group") === "LEO"
        ? route.fulfill({ status: 200, body: fx("snapshot-leo.bin.gz"), contentType: "application/octet-stream" })
        : route.fulfill({ status: 404, body: JSON.stringify({ error: { code: "not_found", message: "none" } }), contentType: "application/json" });
    }
    if (path === "/globe/names") {
      return url.searchParams.get("group") === "LEO"
        ? route.fulfill({ status: 200, body: fx("api/names-leo.json"), contentType: "application/json" })
        : route.fulfill({ status: 404, body: JSON.stringify({ error: { code: "not_found", message: "none" } }), contentType: "application/json" });
    }
    const file = map[path];
    return file
      ? route.fulfill({ status: 200, body: fx(file), contentType: "application/json" })
      : route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
  });
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

// The snapshot fixture's header says it was published 2026-09-23T12:00:00Z. Tests that read the
// status pill set the page's system clock relative to that, so the age is deterministic — via
// setSystemTime, not setFixedTime. anime.js (the tile count-up and chart draw-in animations) times
// every tween with Date.now() (not requestAnimationFrame timestamps — see node_modules/animejs's
// engine, which uses Date.now for Node compatibility); setFixedTime freezes Date.now, which
// freezes every one of those tweens mid-flight (tiles stuck at "0", chart lines never drawn) since
// nothing then advances it for them to measure elapsed time against. setSystemTime only sets the
// starting point and lets time continue to advance normally, so animations still complete.
const FIXTURE_PUBLISHED = Date.parse("2026-09-23T12:00:00Z");
const hoursAfterFixture = (h: number) => new Date(FIXTURE_PUBLISHED + h * 3_600_000);

test("explorer renders tiles, charts, globe and attribution", async ({ page }) => {
  const errors = trackErrors(page);
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByTestId("tile-PAY")).toContainText("17,750", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Payloads overtook debris in 2024" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.getByRole("img", { name: "Objects in orbit per year by type" }).scrollIntoViewIfNeeded();
  await expect(page.locator("path[data-series]")).toHaveCount(3);
  await expect(page.getByText("Data: USSPACECOM via Space-Track.org; CelesTrak.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("search opens the object card", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Find an object").fill("ISS");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  await expect(page.getByTestId("object-card")).toContainText("International Space Station partners");
});

test("zooming in on a searched object shows name labels near the centre; clicking one opens its card", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  // Fly to ISS via search rather than wheel-zooming at the canvas centre: the snapshot fixture
  // has only 2 objects, so a blind zoom can leave both off-screen depending on where the globe
  // happens to be facing (flaky). flyTo brings the camera to ~1.5 Earth radii, below the 2.2
  // SHOW_BELOW threshold, looking straight at ISS.
  await page.getByLabel("Find an object").fill("ISS");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  const labelsContainer = page.getByTestId("globe-labels");
  const labels = labelsContainer.locator("button");
  const issLabel = labels.filter({ hasText: "ISS (ZARYA)" });
  await expect(issLabel.first()).toBeVisible({ timeout: 15_000 });
  expect(await labels.count()).toBeLessThanOrEqual(12);
  await issLabel.first().click();
  await expect(page.getByTestId("object-card")).toBeVisible();
  // Zoom back out with the mouse wheel over the canvas until labels deactivate and clear. Hover
  // a corner rather than dead centre: the ISS label sits right over the canvas centre (the
  // camera looks straight at it after flyTo) and, being pointer-events:auto, would otherwise
  // swallow the wheel events meant for OrbitControls.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 400);
  await expect(labelsContainer).toHaveAttribute("data-active", "0", { timeout: 15_000 });
  expect(await labels.count()).toBe(0);
});

test("selecting a higher-orbit search result turns on Higher orbits and flies to it", async ({ page }) => {
  await mockApi(page);
  const HIGH_ID = 99001;
  await page.route("**/api/globe/snapshot**", (route) =>
    new URL(route.request().url()).searchParams.get("group") === "HIGH"
      ? route.fulfill({ status: 200, body: snapshotWithIds([HIGH_ID, 99002]), contentType: "application/octet-stream" })
      : route.fallback(),
  );
  await page.route("**/api/globe/names**", (route) =>
    new URL(route.request().url()).searchParams.get("group") === "HIGH"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generated_at: "2026-09-23T12:00:00Z", names: { [HIGH_ID]: "TEST GEO", 99002: "OTHER GEO" } }) })
      : route.fallback(),
  );
  await page.route("**/api/objects/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ norad_id: HIGH_ID, name: "TEST GEO", cospar_id: "2020-001A", object_type: "PAY", owner: "US", regime: "GEO", decayed: false }]),
    }),
  );
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByLabel("Find an object").fill("test geo");
  await page.getByRole("button", { name: /TEST GEO/ }).click();
  await expect(page.getByTestId("filter-summary")).toContainText("All orbits");
  await expect(page.getByTestId("globe-labels").locator("button", { hasText: "TEST GEO" })).toBeVisible({ timeout: 15_000 });
});

test("a re-entered object's card says why it has no position", async ({ page }) => {
  await mockApi(page);
  const obj = JSON.parse(fx("api/object.json").toString());
  await page.route("**/api/objects/25544", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...obj, decay_date: "2024-03-08" }) }),
  );
  await page.route("**/api/objects/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ norad_id: 25544, name: "ISS (ZARYA)", cospar_id: "1998-067A", object_type: "PAY", owner: "ISS", regime: "LEO", decayed: true }]),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Find an object").fill("iss");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  await expect(page.getByTestId("no-position")).toContainText("Re-entered on");
});

test("an object missing from its loaded group says there is no current orbit data", async ({ page }) => {
  await mockApi(page);
  const obj = JSON.parse(fx("api/object.json").toString());
  await page.route("**/api/objects/12345", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...obj, norad_id: 12345, decay_date: null, regime: "LEO" }) }),
  );
  await page.route("**/api/objects/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ norad_id: 12345, name: "LOST SAT", cospar_id: "2001-001A", object_type: "PAY", owner: "US", regime: "LEO", decayed: false }]),
    }),
  );
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByLabel("Find an object").fill("lost");
  await page.getByRole("button", { name: /LOST SAT/ }).click();
  await expect(page.getByTestId("no-position")).toHaveText("No current orbit data for this object.", { timeout: 15_000 });
});

test("survives API failure", async ({ page }) => {
  const errors = trackErrors(page);
  await mockApi(page, { "/": { status: 500 } });
  await page.goto("/");
  await expect(page.getByText(/Data unavailable/).first()).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("shows note when snapshot is missing", async ({ page }) => {
  await mockApi(page, { "/globe/snapshot": { status: 404 } });
  await page.goto("/");
  await expect(page.getByText("Orbit data not available yet.")).toBeVisible({ timeout: 10_000 });
});

test("loads globe snapshots from the published generation", async ({ page }) => {
  const snapshotUrls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/globe/snapshot")) snapshotUrls.push(r.url());
  });
  await mockApi(page);
  await page.goto("/");
  await expect.poll(() => snapshotUrls.length).toBeGreaterThan(0);
  expect(new URL(snapshotUrls[0]).searchParams.get("gen")).toBe("20260924T004100Z-r42");
});

test("falls back to the un-versioned snapshot when the pointer fetch fails", async ({ page }) => {
  const snapshotUrls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/globe/snapshot")) snapshotUrls.push(r.url());
  });
  await mockApi(page, { "/globe/current": { status: 500 } });
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(() => snapshotUrls.length).toBeGreaterThan(0);
  expect(new URL(snapshotUrls[0]).searchParams.get("gen")).toBeNull();
});

test("phone: bottom sheet with tabs, no horizontal overflow", async ({ page }) => {
  await page.clock.setSystemTime(hoursAfterFixture(2));
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  const sheet = page.getByTestId("mobile-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("panel-dock")).toHaveCount(0);
  // The status pill moved to a top bar on phone (see GlobeSection) so the open sheet, which
  // covers roughly the lower half of the screen, never covers it.
  const badge = page.getByTestId("live-badge");
  await expect(badge).toBeVisible();
  const badgeBox = await badge.boundingBox();
  const sheetBox = await sheet.boundingBox();
  if (!badgeBox || !sheetBox) throw new Error("missing bounding box for the status pill or sheet");
  const overlap = badgeBox.x < sheetBox.x + sheetBox.width && sheetBox.x < badgeBox.x + badgeBox.width
    && badgeBox.y < sheetBox.y + sheetBox.height && sheetBox.y < badgeBox.y + badgeBox.height;
  expect(overlap, "status pill must not overlap the sheet").toBe(false);
  expect(badgeBox.y + badgeBox.height, "status pill should sit in the top 20% of the screen").toBeLessThanOrEqual(844 * 0.2);
  // The date/sun readout lives in the same top bar, on one line, without overlapping the Earth.
  const readout = page.getByTestId("globe-readout");
  await expect(readout).toBeVisible();
  await expect(readout).toContainText("UTC");
  // The Earth's projected centre (data-earth-cy, written by GlobeScene outside production) must sit
  // within +/-5% of screen height of the midpoint between the top bar's bottom and the sheet's top
  // — on the short Overview tab AND the tall History tab (a taller sheet moves the Earth up; it
  // never magnifies it).
  const globeSection = page.getByLabel("Live globe of tracked objects");
  const topBar = page.getByTestId("globe-topbar");
  const expectCentred = async (tab: string) => {
    await expect.poll(async () => {
      const tb = await topBar.boundingBox();
      const sb = await sheet.boundingBox();
      const cy = Number(await globeSection.getAttribute("data-earth-cy"));
      if (!tb || !sb || !Number.isFinite(cy)) return Infinity;
      return Math.abs(cy - (tb.y + tb.height + sb.y) / 2);
    }, { timeout: 5_000, message: `${tab}: Earth centre should be within 5% of the top-bar/sheet midpoint` }).toBeLessThanOrEqual(844 * 0.05);
  };
  await expect.poll(async () => globeSection.getAttribute("data-earth-cy"), { timeout: 5_000 }).not.toBeNull();
  await expectCentred("Overview");
  await sheet.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("path[data-series]")).toHaveCount(3, { timeout: 10_000 });
  await expectCentred("History");
  // ...and on the tallest tab the whole Earth clears the top bar.
  await expect.poll(async () => {
    const tb = await topBar.boundingBox();
    return Number(await globeSection.getAttribute("data-earth-top")) - (tb!.y + tb!.height);
  }, { timeout: 5_000, message: "History: Earth's top edge must be below the top bar" }).toBeGreaterThanOrEqual(0);
  await sheet.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByTestId("tile-PAY")).toContainText("17,750");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("about page credits the team", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByText(/Jessica Semaan/)).toBeVisible();
});

test("a broken globe render falls back without breaking the rest of the page", async ({ page }) => {
  const errors = trackErrors(page);
  // Test-only hook read by GlobeScene (see web/src/components/globe/GlobeScene.tsx), gated to
  // development/test builds — forces the R3F render tree to throw so GlobeErrorBoundary's
  // fallback path can be exercised end-to-end, the way a real WebGL/shader/driver failure would.
  await page.addInitScript(() => {
    (window as unknown as { __LEO_FORCE_GLOBE_ERROR__?: boolean }).__LEO_FORCE_GLOBE_ERROR__ = true;
  });
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByText(/This device can.t show the 3D globe \(WebGL is unavailable\)/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("canvas")).toHaveCount(0);
  // The rest of the page must still work: tiles and charts render, nothing else crashed.
  await expect(page.getByTestId("tile-PAY")).toContainText("17,750");
  await page.getByRole("img", { name: "Objects in orbit per year by type" }).scrollIntoViewIfNeeded();
  await expect(page.locator("path[data-series]")).toHaveCount(3);
  // React's development-mode error-boundary machinery (invokeGuardedCallback) deliberately
  // re-surfaces a caught render error to the browser console/devtools for stack-trace fidelity —
  // https://github.com/facebook/react/issues/10474 — which Playwright's `pageerror` listener also
  // observes, even though GlobeErrorBoundary genuinely caught it (already proven by the fallback
  // text, the missing canvas, and the rest of the page rendering above). This is development-only
  // noise (next dev is what this whole e2e suite runs against), not a real escape past the
  // boundary; assert it is *exactly* the one forced error and nothing else broke.
  expect(errors).toEqual(["Forced globe error (test-only, via window.__LEO_FORCE_GLOBE_ERROR__)"]);
});

test("ignores a stale timeseries response when filters change before it arrives", async ({ page }) => {
  const errors = trackErrors(page);
  const full = JSON.parse(fx("api/timeseries.json").toString()) as { series: { key: string }[] };
  let calls = 0;
  await mockApi(page);
  // Registered *after* mockApi's catch-all so it takes priority (Playwright tries the
  // most-recently-registered matching route first). The first request (the page's initial,
  // unfiltered load) resolves slowly; a request made after toggling a filter resolves fast.
  // Without the `cancelled` guard in page.tsx, the slow first response arriving later would
  // overwrite the correctly-filtered fast one.
  await page.route("**/api/stats/timeseries**", async (route) => {
    calls += 1;
    const isFirst = calls === 1;
    const url = new URL(route.request().url());
    const types = (url.searchParams.get("types") ?? "PAY,R/B,DEB,UNK").split(",");
    const body = { ...full, series: full.series.filter((s) => types.includes(s.key)) };
    await new Promise((r) => setTimeout(r, isFirst ? 700 : 30));
    await route.fulfill({ status: 200, body: JSON.stringify(body), contentType: "application/json" });
  });
  await page.goto("/");
  await expect(page.locator("path[data-series]")).toHaveCount(3, { timeout: 10_000 });
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Debris" }).click(); // drops DEB from `types` -> 2 series, fast response
  await expect(page.locator("path[data-series]")).toHaveCount(2, { timeout: 5_000 });
  await page.waitForTimeout(900); // outlive the slow first (unfiltered) response
  await expect(page.locator("path[data-series]")).toHaveCount(2); // must still be 2, not reverted to 3
  expect(errors).toEqual([]);
});

test("globe fills the viewport with no card frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto("/");
  // R3F's <Canvas> starts at the browser's default 300x150 and syncs to its container's real
  // size via a ResizeObserver a beat after mount (dynamic import + WebGL probe + hydration), so
  // poll instead of reading boundingBox() once right after goto.
  await expect.poll(async () => (await page.locator("canvas").boundingBox())?.width).toBeGreaterThanOrEqual(1440 - 1);
  const box = await page.locator("canvas").boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(900 - 1);
  await expect(page.locator("section.card")).toHaveCount(0);
});

test("a panel hides with × and comes back from the dock, across reloads", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Hide History" }).click();
  await expect(page.locator('[data-panel="history"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-panel="history"]')).toHaveCount(0);
  await page.getByTestId("panel-dock").getByRole("button", { name: "History" }).click();
  await expect(page.locator('[data-panel="history"]')).toBeVisible();
});

test("hiding all panels leaves the dock to restore them", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  for (const name of ["Overview", "Search", "History", "Owners"]) {
    await page.getByRole("button", { name: `Hide ${name}` }).click();
  }
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByTestId("panel-dock").getByRole("button", { name: "Overview" }).click();
  await expect(page.getByTestId("tile-PAY")).toBeVisible();
});

test("panels do not overlap at 1280x720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("path[data-series]")).toHaveCount(3, { timeout: 10_000 });
  const boxes = await page.locator("[data-panel]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `panels ${i} and ${j} overlap`).toBe(false);
    }
});

// Every viewport: nothing overlaps (panels, dock, sheet, control bar) and the status pill is
// really visible — the element at its centre is the pill itself, not something covering it.
for (const [w, h] of [[640, 900], [768, 1024], [844, 390], [1024, 768], [1280, 720]] as const) {
  test(`${w}x${h}: no overlap and status pill visible`, async ({ page }) => {
    await page.clock.setSystemTime(hoursAfterFixture(2));
    await page.setViewportSize({ width: w, height: h });
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator("path[data-series], [data-testid=tile-PAY]").first()).toBeVisible({ timeout: 10_000 });
    const sheetLayout = w < 1024 || h < 560;
    await expect(page.getByTestId("mobile-sheet")).toHaveCount(sheetLayout ? 1 : 0);
    await expect(page.getByTestId("panel-dock")).toHaveCount(sheetLayout ? 0 : 1);
    await page.waitForTimeout(500); // let charts/ResizeObservers settle
    const boxes = await page.locator("[data-panel], [data-testid=panel-dock], [data-testid=mobile-sheet], [data-testid=globe-topbar]")
      .evaluateAll((els) => els.map((e) => {
        const target = e.getAttribute("data-testid") === "globe-topbar" ? [...e.children] : [e];
        const rs = target.map((t) => t.getBoundingClientRect());
        return { id: e.getAttribute("data-panel") ?? e.getAttribute("data-testid"), rects: rs.map((r) => r.toJSON() as DOMRect) };
      }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        for (const a of boxes[i].rects)
          for (const b of boxes[j].rects) {
            const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            expect(overlap, `${boxes[i].id} overlaps ${boxes[j].id}`).toBe(false);
          }
    // Panels may extend past the viewport inside a (scrollable) desktop column; the columns
    // themselves, the dock, the sheet and the control bar must all fit on screen.
    const onScreen = await page.locator("[data-col], [data-testid=panel-dock], [data-testid=mobile-sheet], [data-testid=globe-topbar] > *")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    for (const b of onScreen) {
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(w);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(h);
    }
    const badge = page.getByTestId("live-badge");
    await expect(badge).toContainText("LIVE");
    const bb = (await badge.boundingBox())!;
    const inside = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid=live-badge]"),
      [bb.x + bb.width / 2, bb.y + bb.height / 2],
    );
    expect(inside, "the element at the status pill's centre belongs to the pill").toBe(true);
    // The spec drops the word "updated" on phones (the top-bar/sheet layout) to keep the pill
    // short; desktop's bottom-centre pill has room to keep it. The word is CSS-hidden
    // (display:none), not removed from the DOM, so it must be read with innerText() (rendering-
    // aware) rather than toContainText()/textContent (which walks hidden nodes too).
    const pillHasUpdated = await badge.innerText().then((t) => t.includes("updated"));
    expect(pillHasUpdated, `"updated" should ${sheetLayout ? "not " : ""}be visible in the ${sheetLayout ? "sheet" : "wide"} layout`).toBe(!sheetLayout);
  });
}

test("the status pill says LIVE with the data age, and the exact time on hover", async ({ page }) => {
  await page.clock.setSystemTime(hoursAfterFixture(2));
  await mockApi(page);
  await page.goto("/");
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("LIVE", { timeout: 10_000 });
  await expect(pill).toContainText("2h ago");
  await expect(pill).toHaveAttribute("title", "Elements published 2026-09-23 12:00 UTC");
});

test("the status pill says DELAYED when the data is over 12 hours old", async ({ page }) => {
  await page.clock.setSystemTime(hoursAfterFixture(14));
  await mockApi(page);
  await page.goto("/");
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("DELAYED", { timeout: 10_000 });
  await expect(pill).toContainText("14h ago");
});

test("a failed higher-orbits load is named in the pill and Retry recovers it", async ({ page }) => {
  await page.clock.setSystemTime(hoursAfterFixture(2));
  await mockApi(page);
  let highFails = true;
  await page.route("**/api/globe/snapshot**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("group") !== "HIGH") return route.fallback();
    return highFails
      ? route.fulfill({ status: 503, body: JSON.stringify({ error: { code: "unavailable", message: "x" } }), contentType: "application/json" })
      : route.fulfill({ status: 200, body: fx("snapshot-leo.bin.gz"), contentType: "application/octet-stream" });
  });
  await page.goto("/");
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("LIVE", { timeout: 10_000 });
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  await expect(pill).toContainText("higher orbits failed");
  highFails = false;
  await pill.getByRole("button", { name: "Retry" }).click();
  await expect(pill).toContainText("2h ago");
  await expect(pill.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a newly published generation replaces the orbits without a reload and keeps the selection", async ({ page }) => {
  await page.clock.setSystemTime(hoursAfterFixture(2));
  await mockApi(page);
  const NEW_GEN = "20260926T064100Z-r43";
  // The default mock (mockApi) serves the same LEO snapshot bytes, with the same header publish
  // time, no matter which generation is asked for — fine for every other test, but this one needs
  // to tell "the new generation's own snapshot arrived" apart from "the old one's did again".
  // Patch a copy of the fixture with a different header time and serve it only for NEW_GEN's LEO
  // request (registered after mockApi's route so it takes priority; see the comment on the
  // timeseries route override elsewhere in this file for why that ordering works).
  const patchedLeo = withPublishTime(fx("snapshot-leo.bin.gz"), "2026-09-23T12:00:00+00:00", "2026-09-23T13:00:00+00:00");
  await page.route("**/api/globe/snapshot**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("group") === "LEO" && url.searchParams.get("gen") === NEW_GEN) {
      return route.fulfill({ status: 200, body: patchedLeo, contentType: "application/octet-stream" });
    }
    return route.fallback();
  });
  let generation = "20260924T004100Z-r42";
  await page.route("**/api/globe/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ generation, generated_at: "2026-09-23T12:00:00+00:00", groups: { LEO: { count: 2 }, HIGH: { count: 0 } } }),
    }),
  );
  const snapshotGenerations: (string | null)[] = [];
  const metaGens: (string | null)[] = [];
  const timeseriesGens: (string | null)[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/globe/snapshot") snapshotGenerations.push(u.searchParams.get("gen"));
    if (u.pathname === "/api/meta") metaGens.push(u.searchParams.get("gen"));
    if (u.pathname === "/api/stats/timeseries") timeseriesGens.push(u.searchParams.get("gen"));
  });
  await page.goto("/");
  await page.getByLabel("Find an object").fill("ISS");
  await page.getByRole("button", { name: /ISS \(ZARYA\)/ }).click();
  await expect(page.getByTestId("object-card")).toBeVisible();
  // check() does nothing while a group is still loading; without waiting for the first load to
  // finish (the pill showing an age, not just "LIVE"), the visibilitychange below can race the
  // in-flight first load and fire a check() that no-ops, leaving nothing to poll for.
  await expect(page.getByTestId("live-badge")).toContainText("2h ago");
  // The first load's requests carry no `gen` (dataVersion is still 0): today's plain URLs. (Dev's
  // Strict Mode can fire an effect's fetch twice — mount, cleanup, remount — so this checks every
  // request seen so far rather than an exact count.)
  expect(metaGens.every((g) => g === null)).toBe(true);
  expect(timeseriesGens.every((g) => g === null)).toBe(true);
  const metaBefore = metaGens.length;
  const timeseriesBefore = timeseriesGens.length;
  generation = NEW_GEN;
  // A check runs whenever the tab becomes visible; the page is visible, so this triggers one.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => snapshotGenerations).toContain(NEW_GEN);
  // The refetches this swap triggers carry `gen=<new generation>`, busting past the CDN's cache
  // on /meta and /stats/timeseries (see globeData's `dataGeneration` and page.tsx).
  await expect.poll(() => metaGens.length).toBeGreaterThan(metaBefore);
  await expect.poll(() => timeseriesGens.length).toBeGreaterThan(timeseriesBefore);
  expect(metaGens.slice(metaBefore)).toContain(NEW_GEN);
  expect(timeseriesGens.slice(timeseriesBefore)).toContain(NEW_GEN);
  await expect(page.getByTestId("object-card")).toBeVisible();
  const pill = page.getByTestId("live-badge");
  await expect(pill).toContainText("LIVE");
  // The pill's title reflects the *new* snapshot's own publish time (13:00), not the pointer's
  // generated_at (still 12:00 above) or the old snapshot's — proof the swap used NEW_GEN's file.
  await expect(pill).toHaveAttribute("title", "Elements published 2026-09-23 13:00 UTC");
});

test("search says when nothing matches, and offers Retry when it fails", async ({ page }) => {
  await mockApi(page);
  let mode: "empty" | "fail" | "ok" = "empty";
  await page.route("**/api/objects/search**", (route) =>
    mode === "empty"
      ? route.fulfill({ status: 200, body: "[]", contentType: "application/json" })
      : mode === "fail"
        ? route.fulfill({ status: 500, body: JSON.stringify({ error: { code: "internal", message: "x" } }), contentType: "application/json" })
        : route.fallback(),
  );
  await page.goto("/");
  const box = page.getByLabel("Find an object");
  await box.fill("zzzz");
  await expect(page.getByText("No matches for “zzzz”.")).toBeVisible();
  await expect(page.getByText("Try a name (ISS), a NORAD number (25544) or a COSPAR ID (1998-067A).")).toBeVisible();
  mode = "fail";
  await box.fill("iss");
  await expect(page.getByText("Search is unavailable right now.")).toBeVisible();
  mode = "ok";
  await page.locator('[data-panel="search"]').getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: /ISS \(ZARYA\)/ })).toBeVisible();
  await expect(page.getByText("1 match")).toBeVisible();
});

test("the Unknown chip filters the chart requests", async ({ page }) => {
  await mockApi(page);
  const typesParams: (string | null)[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/stats/timeseries") typesParams.push(u.searchParams.get("types"));
  });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Unknown", exact: true }).click();
  await expect.poll(() => typesParams.at(-1)).toBe("PAY,R/B,DEB");
  await expect(page.getByTestId("filter-summary")).toContainText("3 of 4 types");
});

test("the owner picker finds any owner by typing and filters History", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  const ownersParams: (string | null)[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/stats/timeseries") ownersParams.push(u.searchParams.get("owners"));
  });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  // A combobox's accessible name is sturdier than a panel-scoped getByLabel: there's exactly one
  // combobox on the page, so this doesn't depend on the Owners panel's own (unrelated) labels.
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.fill("ger");
  const option = page.getByRole("option", { name: /Germany/ }).first();
  // The list used to render absolutely positioned inside the (overflow-y-auto) desktop column,
  // which clipped it below the fold; Playwright's own auto-scroll masked that in round 1's test.
  // It now renders in normal flow and scrolls itself into view, so this must hold without any
  // scrolling this test does itself.
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(option).toBeInViewport();
  await option.click();
  await expect.poll(() => ownersParams.at(-1)).toBe("GER");
  await expect(ownerInput).toHaveValue("🇩🇪 Germany");
  await expect(page.getByTestId("filter-summary")).toContainText("🇩🇪 Germany");
});

test("open owner options stay visible on the phone sheet too, not just clipped by Playwright's auto-scroll", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  // With the field already near the bottom of the sheet's own scrolling tab panel (as it would be
  // with more content above it, or after the user scrolls down), the absolutely-positioned list
  // used to render mostly below the panel's clipped edge — genuinely covered by only a sliver, not
  // just failing a naive "some pixel is on screen" check (which the panel's clipping doesn't even
  // affect: a 0-height scrollIntoView + a lenient default toBeInViewport() would pass either way).
  await ownerInput.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await ownerInput.click();
  await ownerInput.fill("ger");
  const option = page.getByRole("option", { name: /Germany/ }).first();
  await expect(option).toBeInViewport({ ratio: 0.5 });
  await option.click();
  await expect(ownerInput).toHaveValue("🇩🇪 Germany");
});

test("holding ArrowDown scrolls the highlighted option into view", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithManyOwners() } });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.click();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowDown");
  const activeId = await ownerInput.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`#${activeId}`)).toBeInViewport();
});

test('ArrowDown on a closed picker starts at "All owners", matching focus', async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.click();
  await page.keyboard.press("Escape"); // closes it but keeps focus in the input
  await page.keyboard.press("ArrowDown");
  const activeId = await ownerInput.getAttribute("aria-activedescendant");
  await expect(page.locator(`#${activeId}`)).toContainText("All owners");
});

test("a resting pointer under a reopened list does not steal the highlight from the selected owner", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.click();
  await ownerInput.pressSequentially("germany");
  await page.keyboard.press("Enter");
  await expect(ownerInput).toHaveValue("🇩🇪 Germany");
  // Reopen (still focused) to find where China's row lands, then close again — same layout each
  // time the list opens with Germany selected and no query.
  await ownerInput.click();
  const chinaBox = (await page.getByRole("option", { name: /^🇨🇳 China/ }).first().boundingBox())!;
  await page.keyboard.press("Escape");
  // Rest the pointer where China's row will render once the list reopens, then blur and refocus
  // with the keyboard alone — the pointer never moves, so its mere presence over a row that just
  // mounted under it must not hijack the highlight away from Germany.
  // Blur programmatically (not via a click elsewhere), so the mouse pointer itself never moves
  // away from where it's about to rest — a click to blur would drag the pointer to wherever it
  // clicked, defeating the whole point of a *resting* pointer.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(chinaBox.x + chinaBox.width / 2, chinaBox.y + chinaBox.height / 2);
  await ownerInput.focus();
  await expect(page.getByRole("listbox")).toBeVisible();
  // Give the browser's own hover recalculation (layout settling under the still pointer) a beat
  // to run before confirming — this is what a real resting pointer reproduces.
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await expect(ownerInput).toHaveValue("🇩🇪 Germany");
});

test("select-all then typing keeps every character, not just the first one dropped", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.click();
  await ownerInput.pressSequentially("germany");
  await page.keyboard.press("Enter");
  await expect(ownerInput).toHaveValue("🇩🇪 Germany");
  await ownerInput.press("Control+a");
  await ownerInput.pressSequentially("chi");
  await expect(ownerInput).toHaveValue("chi");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: /^🇨🇳 China/ })).toBeVisible();
});

test("selecting an owner then typing right away starts a fresh search, not the stale label plus a keystroke", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.click();
  await ownerInput.pressSequentially("china");
  await page.keyboard.press("Enter");
  await expect(ownerInput).toHaveValue("🇨🇳 China");
  // Selecting via Enter/click leaves focus in the box, so this keystroke arrives with the box
  // still showing "🇨🇳 China" — it must not search for "🇨🇳 Chinag" (unmatchable) and then "ger".
  await page.keyboard.type("ger");
  await expect(page.getByRole("option", { name: /Germany/ }).first()).toBeVisible();
});

test("the filter summary appears when filters change and Reset restores the defaults", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("filter-summary")).toHaveCount(0);
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Higher orbits" }).click();
  const summary = page.getByTestId("filter-summary");
  await expect(summary).toContainText("Showing All orbits · All owners · all types");
  await summary.getByRole("button", { name: "Reset filters" }).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Higher orbits" })).toHaveAttribute("aria-pressed", "false");
});

test("the Owners chart ranks all owners and highlights the selected one, with its rank when outside the top 5", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  const breakdownOwners: (string | null)[] = [];
  await page.route("**/api/stats/breakdown**", async (route) => {
    const u = new URL(route.request().url());
    breakdownOwners.push(u.searchParams.get("owners"));
    const body = JSON.parse(fx("api/breakdown.json").toString());
    if (u.searchParams.get("rank_of") === "GER") body.rank_of = { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await expect(page.getByTestId("owners-scope")).toHaveText("All owners, ranked · Low Earth orbit · all types");
  await expect(page.getByTestId("history-scope")).toHaveText("Low Earth orbit · All owners · all types");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("combobox", { name: "Owner" }).fill("germany");
  await page.getByRole("option", { name: /^🇩🇪 Germany/ }).click();
  const row = page.locator('[data-row="GER"]');
  await expect(row).toContainText("#9");
  await expect(row).toHaveAttribute("data-highlight", "true");
  await expect(page.getByTestId("history-scope")).toHaveText("Low Earth orbit · 🇩🇪 Germany · all types");
  expect(breakdownOwners.every((o) => o === null)).toBe(true);
});

test("shows no false 'none under these filters' row while a newly selected owner's rank is still loading", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  await page.route("**/api/stats/breakdown**", async (route) => {
    const u = new URL(route.request().url());
    const body = JSON.parse(fx("api/breakdown.json").toString());
    if (u.searchParams.get("rank_of") === "GER") {
      await new Promise((r) => setTimeout(r, 600));
      body.rank_of = { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("combobox", { name: "Owner" }).fill("germany");
  await page.getByRole("option", { name: /^🇩🇪 Germany/ }).click();
  // The bars still on screen were fetched before Germany was selected (rank_of never asked for
  // it) — while Germany's own (delayed) response is in flight, there must be no extra row at all
  // for it, not a false "Germany #— 0" claiming it has none under these filters.
  await expect(page.locator('[data-row="GER"]')).toHaveCount(0);
  await expect(page.locator('[data-row="GER"]')).toContainText("#9", { timeout: 5_000 });
});

test("the Owners legend only lists the types present in the ranked data", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const ownersPanel = page.locator('[data-panel="owners"]');
  await ownersPanel.getByRole("img", { name: "Objects in orbit by owner and type" }).scrollIntoViewIfNeeded();
  // The breakdown fixture has no Unknown counts at all (PAY/DEB/R/B only) — the legend must not
  // claim a fourth type the chart has no segment for, the way the History legend already follows
  // visibleTypeSeries.
  await expect(ownersPanel.getByText("Unknown", { exact: true })).toHaveCount(0);
  await expect(ownersPanel.getByText("Payloads", { exact: true })).toBeVisible();
  await expect(ownersPanel.getByText("Debris", { exact: true })).toBeVisible();
  await expect(ownersPanel.getByText("Rocket bodies", { exact: true })).toBeVisible();
});

test("the highlighted owner's total is bright, not dimmed like the others", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("img", { name: "Objects in orbit by owner and type" }).scrollIntoViewIfNeeded();
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("combobox", { name: "Owner" }).fill("china");
  await page.getByRole("option", { name: /^🇨🇳 China/ }).click();
  const total = page.locator('[data-row="PRC"] text').last();
  await expect(total).toHaveClass(/(^|\s)fill-ink(\s|$)/);
});

test("a long owner name's rank is never truncated away", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockApi(page, { "/meta": { status: 200, body: metaWithLongOwnerName() } });
  await page.route("**/api/stats/breakdown**", async (route) => {
    const u = new URL(route.request().url());
    const body = JSON.parse(fx("api/breakdown.json").toString());
    if (u.searchParams.get("rank_of") === "LONG") body.rank_of = { key: "LONG", rank: 9, counts: { PAY: 86 }, total: 86 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("combobox", { name: "Owner" }).fill("Z");
  await page.getByRole("option", { name: /^Z{50}/ }).first().click();
  // The name itself is long enough to need truncating; the rank must survive that intact.
  await expect(page.locator('[data-row="LONG"]')).toContainText("#9");
});

test("selecting an owner does not replay the ranked bars' entrance animation", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithOwners() } });
  // The ranked rows (US, PRC, _other) never change; only `rank_of` (and so the response body,
  // hence the `data` object's identity) changes when Germany is selected — the scenario that
  // used to replay the whole entrance animation.
  await page.route("**/api/stats/breakdown**", async (route) => {
    const u = new URL(route.request().url());
    const body = JSON.parse(fx("api/breakdown.json").toString());
    if (u.searchParams.get("rank_of") === "GER") body.rank_of = { key: "GER", rank: 9, counts: { PAY: 86 }, total: 86 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.getByRole("img", { name: "Objects in orbit by owner and type" }).scrollIntoViewIfNeeded();
  const usSeg = page.locator('[data-row="US"] rect[data-seg]').first();
  await expect(usSeg).toBeVisible();
  // Outlive the entrance animation (800ms duration, up to ~480ms of stagger across every segment).
  await page.waitForTimeout(1800);
  const before = (await usSeg.boundingBox())!;
  expect(before.width).toBeGreaterThan(5);
  await page.getByTestId("panel-dock").getByRole("button", { name: "Filters" }).click();
  await page.getByRole("combobox", { name: "Owner" }).fill("germany");
  await page.getByRole("option", { name: /^🇩🇪 Germany/ }).click();
  // Checked immediately after selecting: a reset-and-replay would collapse this bar back to
  // (near) zero width for the first frames of its re-animation, well before it could recover.
  const after = (await usSeg.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 0.9);
});

test("a long owner name doesn't overflow the page or make the summary pill more than two lines tall", async ({ page }) => {
  await mockApi(page, { "/meta": { status: 200, body: metaWithLongOwnerName() } });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Filters" }).click();
  const ownerInput = page.getByRole("combobox", { name: "Owner" });
  await ownerInput.fill("Z");
  await page.getByRole("option", { name: /^Z{50}/ }).first().click();
  const summary = page.getByTestId("filter-summary");
  await expect(summary).toContainText("ZZZ");
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
  const box = (await summary.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(64);
});
