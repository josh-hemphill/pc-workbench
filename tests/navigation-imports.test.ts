import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeCSV, encodeCSV, Store } from "../server/store.ts";
import { previewImport } from "../server/csv-preview.ts";
import { createApp } from "../server/app.ts";
import {
  encodeWorkspaceRoute,
  parseWorkspaceRoute,
  routePages,
  workspaceRoute,
} from "../shared/workspace-route.ts";
const locations = [{
  id: "loc-root",
  name: "Site",
  kind: "Site",
  parentId: "",
  requirementSetId: "",
  requirementRevision: 0,
  targetConfigurationId: "",
  notes: "",
}, {
  id: "loc-child",
  name: "Bench",
  kind: "Bench",
  parentId: "loc-root",
  requirementSetId: "",
  requirementRevision: 0,
  targetConfigurationId: "",
  notes: "",
}];

test("page and subpage URLs preserve record IDs views and editor addresses", () => {
  for (const page of Object.values(routePages)) {
    const route = workspaceRoute(page);
    assert.deepEqual(parseWorkspaceRoute(encodeWorkspaceRoute(route)), route);
  }
  for (
    const hash of [
      "#/configurations/cfg-1/storage",
      "#/pcs/pc-1/history",
      "#/pcs/pc-1/inspection",
      "#/stock/stock-1/allocations",
      "#/catalog/queue",
      "#/installations/locations/loc-child",
      "#/installations/operations",
      "#/installations/distribution",
      "#/transitions/plan-1",
      "#/catalog/components?edit=component&record=ssd",
    ]
  ) assert.equal(encodeWorkspaceRoute(parseWorkspaceRoute(hash)), hash);
  assert.equal(parseWorkspaceRoute("#/catalog-data").view, "gaps");
  assert.equal(parseWorkspaceRoute("#/unknown").page, "Configurations");
  assert.deepEqual(
    parseWorkspaceRoute("#/pcs/%broken/history"),
    workspaceRoute(),
  );
});
test("CSV header normalization accepts spreadsheet casing spacing and location ID labels", () => {
  const csv = encodeCSV("installationLocations", locations),
    header = csv.split("\n")[0];
  for (const replacement of ["ID", " id ", "Location ID"]) {
    assert.deepEqual(
      decodeCSV(
        "installationLocations",
        csv.replace(/^id,/, replacement + ","),
      ),
      decodeCSV("installationLocations", csv),
    );
  }
  assert.deepEqual(
    decodeCSV(
      "installationLocations",
      csv.replace(
        header,
        header.replace("parentId", "Parent ID").replace(
          "requirementRevision",
          "Requirement Revision",
        ),
      ),
    ),
    decodeCSV("installationLocations", csv),
  );
});
test("location CSV imports support semicolon and tab spreadsheet delimiters and ignore wholly empty rows", () => {
  const csv = encodeCSV("installationLocations", locations);
  for (const delimiter of [";", "\t"]) {
    assert.deepEqual(
      decodeCSV("installationLocations", csv.replaceAll(",", delimiter)),
      decodeCSV("installationLocations", csv),
    );
  }
  assert.deepEqual(
    decodeCSV("installationLocations", csv + ",,,,,,,,\r\n,,,,,,,,\r\n"),
    decodeCSV("installationLocations", csv),
  );
});
test("missing IDs are diagnosed before duplicates and real duplicate errors identify the ID and rows", () => {
  const csv = encodeCSV("installationLocations", locations);
  assert.throws(
    () =>
      decodeCSV("installationLocations", csv.replace(/^id,/, "identifier,")),
    /missing the ID column/,
  );
  assert.throws(
    () =>
      decodeCSV(
        "installationLocations",
        csv.replace("loc-child,Bench", ",Bench"),
      ),
    /row 3: missing record ID/,
  );
  assert.throws(
    () =>
      decodeCSV(
        "installationLocations",
        csv.replace("loc-child,Bench", "loc-root,Bench"),
      ),
    /duplicate record ID "loc-root" on rows 2 and 3/,
  );
  assert.throws(
    () =>
      decodeCSV("installationLocations", csv.replace(/^id,name,/, "id,ID,")),
    /duplicate column "id"/,
  );
});
test("a cleared location collection can preview and reimport a whole hierarchy with spreadsheet headers", () => {
  const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "bench-location-reimport-"),
    ),
    store = new Store(dir);
  try {
    store.replace("installationLocations", locations);
    store.replace("installationLocations", []);
    const csv = encodeCSV("installationLocations", locations).replace(
      /^id,/,
      "ID,",
    );
    const preview = previewImport(store, "installationLocations", csv);
    assert.equal(preview.valid, true, preview.error);
    assert.deepEqual(preview.rows.map((r) => r.status), ["Add", "Add"]);
    store.replace("installationLocations", preview.candidate);
    assert.equal(store.db.installationLocations[1].parentId, "loc-root");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("the reviewed location import API accepts a fresh spreadsheet hierarchy and rejects true duplicates atomically", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-location-api-")),
    server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${
    (server.address() as { port: number }).port
  }`;
  const request = (
    route: string,
    method = "GET",
    body?: unknown,
    revision?: string,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(revision ? { "If-Match": revision } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const csv = encodeCSV("installationLocations", locations).replace(
      /^id,/,
      "Location ID,",
    ).replaceAll(",", ";");
    const preview = await (await request("/api/import/preview", "POST", {
      collection: "installationLocations",
      csv,
    })).json();
    assert.equal(preview.valid, true, preview.error);
    const applied = await request("/api/import/apply", "POST", {
      collection: "installationLocations",
      csv,
      token: preview.token,
    }, preview.revision);
    assert.equal(applied.status, 200, await applied.text());
    const state = await (await request("/api/state")).json();
    assert.equal(state.installationLocations.length, 2);
    const invalid = await (await request("/api/import/preview", "POST", {
      collection: "installationLocations",
      csv: csv.replace("loc-child;Bench", "loc-root;Bench"),
    })).json();
    assert.equal(invalid.valid, false);
    assert.match(invalid.error, /duplicate record ID/);
    assert.equal(
      (await (await request("/api/state")).json()).revision,
      state.revision,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("edited exported locations restore after deleting all locations, including spreadsheet-added blank rows", async () => {
  const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "bench-location-roundtrip-"),
    ),
    server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${
    (server.address() as { port: number }).port
  }`;
  const request = (
    route: string,
    method = "GET",
    body?: unknown,
    revision?: string,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(revision ? { "If-Match": revision } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const state = async () => await (await request("/api/state")).json();
  try {
    for (const location of locations) {
      const response = await request(
        `/api/installationLocations/${location.id}`,
        "PUT",
        location,
        (await state()).revision,
      );
      assert.equal(response.status, 200, await response.text());
    }
    const exported = await (await request(
      "/api/export/installationLocations?spreadsheet=true",
    )).text();
    const edited = decodeCSV(
      "installationLocations",
      exported,
    ) as typeof locations;
    edited[0].name = "Site, revised";
    edited[1].notes = "Reimported edited export";
    const deletion = {
      collection: "installationLocations",
      action: "delete",
      ids: edited.map((l) => l.id),
    };
    const reviewed =
      await (await request("/api/bulk/preview", "POST", deletion)).json();
    assert.equal(reviewed.valid, true, reviewed.error);
    assert.equal(
      (await request("/api/bulk/apply", "PUT", {
        request: deletion,
        token: reviewed.token,
      }, reviewed.revision)).status,
      200,
    );
    assert.equal((await state()).installationLocations.length, 0);
    const csv = encodeCSV("installationLocations", edited) +
      ",,,,,,,,\r\n,,,,,,,,\r\n";
    const preview = await (await request("/api/import/preview", "POST", {
      collection: "installationLocations",
      csv,
    })).json();
    assert.equal(preview.valid, true, preview.error);
    assert.deepEqual(
      preview.rows.map((row: { status: string }) => row.status),
      ["Add", "Add"],
    );
    assert.equal(
      (await request("/api/import/apply", "POST", {
        collection: "installationLocations",
        csv,
        token: preview.token,
      }, preview.revision)).status,
      200,
    );
    const restored = (await state()).installationLocations;
    assert.equal(restored.length, 2);
    assert.equal(restored[0].id, locations[0].id);
    assert.equal(restored[0].name, "Site, revised");
    assert.equal(restored[1].parentId, restored[0].id);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
