import assert from "node:assert/strict";
import test from "node:test";
import { BOOKMARK_STORAGE_KEY, readBookmarkState, writeBookmarkState, type BookmarkStateSnapshot, type BookmarkStorage } from "../lib/bookmark-storage.ts";

function memoryStorage(): BookmarkStorage & { values: Map<string, string>; writes: string[] } {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes.push(key); },
  };
}

const before: BookmarkStateSnapshot = {
  version: 2,
  colors: [{ id: "local-prayer", name: "Prayer", value: "#ffaa00" }],
  markings: [{
    id: "my-bookmark", colorId: "local-prayer", passage: { translation: "kjv", book: 43, chapter: 3 },
    verse: 16, start: null, end: null, quote: "My verse", reference: "John 3:16", createdAt: 1,
  }],
  activeColorId: "local-prayer",
  setup: "legacy",
};

test("bookmark snapshots atomically persist topics, their records, and migration acceptance", () => {
  const storage = memoryStorage();
  const migrated: BookmarkStateSnapshot = {
    ...before,
    setup: "current",
    colors: [{ ...before.colors[0], source: { type: "shared-bookmark", topicId: "prayer" } }],
    markings: [...before.markings, {
      ...before.markings[0], id: "global-prayer", quote: "", source: { type: "shared-bookmark", topicId: "prayer" },
    }],
  };
  writeBookmarkState(storage, migrated);
  assert.deepEqual(storage.writes, [BOOKMARK_STORAGE_KEY]);
  assert.deepEqual(readBookmarkState(storage), migrated);
});

test("a quota failure preserves the complete previous bookmark snapshot", () => {
  const storage = memoryStorage();
  writeBookmarkState(storage, before);
  const previousBytes = storage.getItem(BOOKMARK_STORAGE_KEY);
  const fullStorage: BookmarkStorage = {
    getItem: storage.getItem,
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
  const migrated: BookmarkStateSnapshot = {
    ...before,
    setup: "current",
    colors: [{ id: "global-prayer", name: "Prayer", value: "#ffaa00" }],
    markings: before.markings.map((marking) => ({ ...marking, colorId: "global-prayer" })),
    activeColorId: "global-prayer",
  };
  assert.throws(() => writeBookmarkState(fullStorage, migrated), /QuotaExceededError/);
  assert.equal(storage.getItem(BOOKMARK_STORAGE_KEY), previousBytes);
  assert.deepEqual(readBookmarkState(storage), before);
});

test("fresh offline and intentionally empty bookmark lists are valid snapshots", () => {
  const storage = memoryStorage();
  const empty: BookmarkStateSnapshot = { version: 2, colors: [], markings: [], activeColorId: "", setup: "fresh" };
  writeBookmarkState(storage, empty);
  assert.deepEqual(readBookmarkState(storage), empty);
});

test("missing, corrupt, unsupported and inaccessible snapshots allow legacy fallback", () => {
  const storage = memoryStorage();
  assert.equal(readBookmarkState(storage), null);
  for (const data of ["current", "{", JSON.stringify({ ...before, version: 3 }), JSON.stringify({ ...before, setup: "pending" }), JSON.stringify({ ...before, colors: [{ id: "bad", name: "Invalid", value: "red" }] }), JSON.stringify({ ...before, markings: [{ ...before.markings[0], source: { type: "shared-bookmark", topicId: "invalid/topic" } }] })]) {
    storage.values.set(BOOKMARK_STORAGE_KEY, data);
    assert.equal(readBookmarkState(storage), null);
  }
  assert.equal(readBookmarkState({ getItem: () => { throw new Error("SecurityError"); } }), null);
});

test("invalid writes fail before replacing an existing snapshot", () => {
  const storage = memoryStorage();
  writeBookmarkState(storage, before);
  assert.throws(() => writeBookmarkState(storage, { ...before, colors: [{ id: "bad", name: "Invalid", value: "red" }] }));
  assert.deepEqual(readBookmarkState(storage), before);
  assert.equal(storage.writes.length, 1);
});
