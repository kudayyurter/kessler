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
