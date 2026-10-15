import { createHash } from "node:crypto";
import type { Collection } from "./schema.ts";
import { decodeCSV, type Store } from "./store.ts";
import { prepareImportedRecord } from "./import-record.ts";

export const importToken = (
  collection: Collection,
  csv: string,
  revision: string,
) =>
  createHash("sha256").update(JSON.stringify({ collection, csv, revision }))
    .digest("hex");
export function previewImport(
  store: Store,
  collection: Collection,
  csv: string,
) {
  const revision = store.revision,
    token = importToken(collection, csv, revision);
  const rows: {
    id: string;
    name: string;
    status: string;
    fields: string;
    before: unknown;
    after: unknown;
    error: string;
  }[] = [];
  const merged = new Map(
    (store.db[collection] as { id: string }[]).map((r) => [r.id, r]),
  );
  try {
    const inputs = decodeCSV(collection, csv) as {
      id: string;
      name?: string;
    }[];
    for (const input of inputs) {
      const before = merged.get(input.id),
        fields = [
          ...new Set([...Object.keys(before ?? {}), ...Object.keys(input)]),
        ].filter((key) =>
          JSON.stringify((input as Record<string, unknown>)[key]) !==
            JSON.stringify(
              (before as Record<string, unknown> | undefined)?.[key],
            )
        );
      const unchanged = !!before && !fields.length;
      const row = {
        id: input.id,
        name: input.name || input.id,
        status: before ? (unchanged ? "Unchanged" : "Update") : "Add",
        fields: fields.join(", "),
        before: before ?? null,
        after: input as unknown,
        error: "",
      };
      try {
        const after = unchanged
          ? before
          : prepareImportedRecord(collection, input, store.db) as {
            id: string;
          };
        merged.set(input.id, after!);
        row.after = after;
      } catch (e) {
        row.status = "Conflict";
        row.error = e instanceof Error ? e.message : String(e);
      }
      rows.push(row);
    }
    if (rows.some((row) => row.status === "Conflict")) {
      throw Error("Resolve the conflicting rows before importing.");
    }
    try {
      store.validateReplacement(collection, [...merged.values()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of rows) {
        if (
          row.status !== "Unchanged" &&
          (message.startsWith(`${row.name}:`) ||
            message.includes(`Stock ${row.id}:`))
        ) {
          row.status = "Conflict";
          row.error = message;
        }
      }
      throw error;
    }
    return {
      valid: true,
      revision,
      token,
      rows,
      error: "",
      candidate: [...merged.values()],
    };
  } catch (e) {
    return {
      valid: false,
      revision,
      token,
      rows,
      error: e instanceof Error ? e.message : String(e),
      candidate: [],
    };
  }
}
