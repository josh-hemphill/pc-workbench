import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { encodeCSV, PlanConflict, Store } from "../server/store";
import { newTransitionScenario } from "../shared/transitions";
import { previewImport } from "../server/csv-preview";
const draft = (id = "plan-1") => ({
  id,
  scenario: null,
  draft: newTransitionScenario(),
  workspaceRevision: "hardware-before",
  draftWorkspaceRevision: "hardware-before",
});
function temporary(run: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ux-"));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("plans and drafts survive restarts and copied workspaces without changing the hardware revision", () =>
  temporary((dir) => {
    let store = new Store(dir);
    const revision = store.revision;
    const plan = store.savePlan(draft(), "missing");
    assert.equal(store.revision, revision);
    assert.equal(plan.draft!.mode, "configuration");
    store.close();
    store = new Store(dir);
    assert.equal(store.plans()[0].revision, plan.revision);
    assert.equal(store.revision, revision);
    store.close();
    const copy = path.join(dir, "copy");
    fs.mkdirSync(copy);
    fs.copyFileSync(
      path.join(dir, "workbench.sqlite"),
      path.join(copy, "workbench.sqlite"),
    );
    const portable = new Store(copy);
    assert.equal(portable.plans()[0].draft!.name, plan.draft!.name);
    portable.close();
  }));
test("plan saves and deletes reject stale revisions across connections", () =>
  temporary((dir) => {
    const first = new Store(dir), second = new Store(dir);
    try {
      const saved = first.savePlan(draft(), "missing");
      assert.throws(() => second.savePlan(draft(), "missing"), PlanConflict);
      const updated = second.savePlan({
        ...draft(),
        draft: { ...newTransitionScenario(), name: "Other window" },
      }, saved.revision);
      assert.throws(
        () => first.savePlan(draft(), saved.revision),
        PlanConflict,
      );
      assert.throws(
        () => first.deletePlan(saved.id, saved.revision),
        PlanConflict,
      );
      first.deletePlan(saved.id, updated.revision);
      assert.equal(second.plans().length, 0);
    } finally {
      first.close();
      second.close();
    }
  }));
test("JSON backups carry saved plans and drafts; legacy backups remain valid and safety backups retain current plans", () =>
  temporary((dir) => {
    const store = new Store(dir);
    try {
      const saved = store.savePlan({
        ...draft(),
        scenario: newTransitionScenario(),
      }, "missing");
      const backup = store.backup();
      assert.equal(backup.transitionPlans![0].draft!.name, saved.draft!.name);
      assert.equal(
        store.validateBackup(backup).pcs.length,
        store.db.pcs.length,
      );
      const safety = store.restore(store.db);
      assert.equal(store.plans().length, 0);
      assert.equal(
        JSON.parse(fs.readFileSync(safety, "utf8")).transitionPlans.length,
        1,
      );
      store.restore(backup);
      assert.equal(store.plans()[0].revision, saved.revision);
      store.replace("systems", store.db.systems);
      const rolling = fs.readdirSync(path.join(dir, "backups")).find((file) =>
        file.startsWith("rolling-")
      )!;
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, "backups", rolling), "utf8"))
          .transitionPlans.length,
        1,
      );
    } finally {
      store.close();
    }
  }));
test("invalid or duplicate plans reject whole-workspace restores atomically and failed record writes preserve plans", () =>
  temporary((dir) => {
    const store = new Store(dir);
    try {
      store.savePlan(draft(), "missing");
      const before = store.backup();
      assert.throws(
        () =>
          store.restore({
            ...before,
            transitionPlans: [
              before.transitionPlans![0],
              before.transitionPlans![0],
            ],
          }),
        /Duplicate/,
      );
      assert.deepEqual(store.backup(), before);
      assert.throws(() =>
        store.savePlan({
          ...draft(),
          draft: { ...newTransitionScenario(), freePercent: 99 },
        }, "missing")
      );
      assert.deepEqual(store.backup(), before);
      const persist = store.persist.bind(store);
      store.persist = (collection, rows) => {
        persist(collection, rows);
        if (collection === "systems") throw Error("Injected disk failure");
      };
      assert.throws(
        () => store.restore({ ...store.db, transitionPlans: [] }),
        /Injected/,
      );
      assert.deepEqual(store.backup(), before);
    } finally {
      store.close();
    }
  }));
test("CSV previews show additions updates and unchanged rows without modifying records or auditing unchanged imports", () =>
  temporary((dir) => {
    const store = new Store(dir);
    try {
      const existing = store.db.components[0];
      const csv = encodeCSV("components", [existing, {
        ...store.db.components[1],
        name: "Preview changed",
      }, { ...existing, id: "csv-added", name: "New model" }]);
      const before = store.backup();
      const result = previewImport(store, "components", csv);
      assert.equal(result.valid, true, result.error);
      assert.deepEqual(result.rows.map((r) => r.status), [
        "Unchanged",
        "Update",
        "Add",
      ]);
      assert.equal(result.rows[1].fields, "name");
      assert.deepEqual(store.backup(), before);
    } finally {
      store.close();
    }
  }));
test("CSV previews report audit conflicts and broken references before applying anything", () =>
  temporary((dir) => {
    const store = new Store(dir);
    try {
      const invalid = previewImport(
        store,
        "pcs",
        encodeCSV("pcs", [{
          ...store.db.pcs[0],
          configurationId: "missing-config",
        }]),
      );
      assert.equal(invalid.valid, false);
      assert.match(invalid.error, /configuration not found/);
      store.replace("inventory", [{
        id: "audit-lot",
        componentId: "ram",
        tracking: "bulk",
        serial: "",
        assetTag: "",
        quantity: 2,
        location: "Shelf",
        condition: "Serviceable",
        notes: "",
        allocations: [],
        history: [],
      }]);
      const result = previewImport(
        store,
        "inventory",
        encodeCSV("inventory", [{ ...store.db.inventory[0], quantity: 3 }]),
      );
      assert.equal(result.valid, false);
      assert.equal(result.rows[0].status, "Conflict");
      assert(result.rows[0].error);
    } finally {
      store.close();
    }
  }));
test("CSV previews enforce compatibility approval rules and retain unchanged operational audit histories", () =>
  temporary((dir) => {
    const store = new Store(dir);
    try {
      const configuration = structuredClone(store.db.configurations[0]);
      configuration.status = "Approved";
      configuration.placements.find((p) => p.componentId === "cpu")!.quantity =
        2;
      const blocked = previewImport(
        store,
        "configurations",
        encodeCSV("configurations", [configuration]),
      );
      assert.equal(blocked.valid, false);
      assert.match(blocked.error, /compatibility conflicts/);
      assert.equal(blocked.rows[0].status, "Conflict");
      store.replace("inventory", [{
        id: "unchanged-lot",
        componentId: "ram",
        tracking: "bulk",
        serial: "",
        assetTag: "",
        quantity: 2,
        location: "Shelf",
        condition: "Serviceable",
        notes: "",
        allocations: [],
        history: [],
      }]);
      const before = store.revision,
        unchanged = previewImport(
          store,
          "inventory",
          encodeCSV("inventory", store.db.inventory),
        );
      assert.equal(unchanged.valid, true);
      assert.equal(unchanged.rows[0].status, "Unchanged");
      assert.deepEqual(unchanged.candidate, store.db.inventory);
      assert.equal(store.revision, before);
    } finally {
      store.close();
    }
  }));
test("previewed imports require the exact file and current revision; plan API uses independent revisions and restore guards drafts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ux-api-")),
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
    const state = await (await request("/api/state")).json(),
      csv = encodeCSV("components", [{
        ...state.components[0],
        name: "Reviewed import",
      }]);
    const preview = await (await request("/api/import/preview", "POST", {
      collection: "components",
      csv,
    })).json();
    assert.equal(preview.valid, true);
    assert.equal(
      (await request("/api/import/apply", "POST", {
        collection: "components",
        csv,
        token: preview.token,
      })).status,
      428,
    );
    assert.equal(
      (await request("/api/import/apply", "POST", {
        collection: "components",
        csv: csv + "\n",
        token: preview.token,
      }, state.revision)).status,
      409,
    );
    assert.equal(
      (await request("/api/transition-plans/plan-1", "PUT", draft())).status,
      428,
    );
    const plan = await (await request(
      "/api/transition-plans/plan-1",
      "PUT",
      draft(),
      "missing",
    )).json();
    assert(plan.revision);
    assert.equal(
      (await (await request("/api/state")).json()).revision,
      state.revision,
    );
    const restore =
      await (await request("/api/restore/preview", "POST", { backup: state }))
        .json();
    // State has response metadata and is not a backup; obtain an actual backup.
    assert(restore.error);
    const backup = await (await request("/api/backup")).json();
    const replacement =
      await (await request("/api/restore/preview", "POST", { backup })).json();
    assert.equal(replacement.transitionPlans, 1);
    assert.equal(
      (await request("/api/transition-plans/plan-1", "PUT", {
        ...draft(),
        draft: { ...newTransitionScenario(), name: "Concurrent draft" },
      }, plan.revision)).status,
      200,
    );
    assert.equal(
      (await request("/api/restore", "POST", {
        backup,
        backupRevision: replacement.backupRevision,
      }, replacement.revision)).status,
      409,
    );
    assert.equal(
      (await request("/api/import/apply", "POST", {
        collection: "components",
        csv,
        token: preview.token,
      }, preview.revision)).status,
      200,
    );
    assert.equal(
      (await request("/api/import/apply", "POST", {
        collection: "components",
        csv,
        token: preview.token,
      }, preview.revision)).status,
      409,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CSV previews detect clearing optional fields as updates rather than unchanged rows", () =>
  temporary((dir) => {
    const store = new Store(dir);
    try {
      const db = structuredClone(store.db);
      db.installationLocations.push({
        id: "optional-location",
        name: "Bench",
        kind: "Bench",
        parentId: "",
        requirementSetId: "",
        requirementRevision: 0,
        targetConfigurationId: "",
        notes: "",
      });
      db.pcs[0].installationLocationId = "optional-location";
      store.restore(db);
      const pc = { ...store.db.pcs[0] };
      delete pc.installationLocationId;
      const preview = previewImport(store, "pcs", encodeCSV("pcs", [pc]));
      assert.equal(preview.valid, true, preview.error);
      assert.equal(preview.rows[0].status, "Update");
      assert(preview.rows[0].fields.includes("installationLocationId"));
      assert.equal(
        (preview.rows[0].after as typeof pc).installationLocationId,
        undefined,
      );
    } finally {
      store.close();
    }
  }));
