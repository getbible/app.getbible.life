import assert from "node:assert/strict";
import test from "node:test";
import { isSharedBookmarkMarking, parseMarkingsBackup, withoutWholeVerseMarking, type Marking, type MarkingColor } from "../lib/markings.ts";
import { bookmarkDefaultColors, bookmarkDisplayRows, bookmarkMigrationPreview, importBookmarkCatalog, importBookmarkTopic, importBookmarkTopicIntoGroups, migrateBookmarkGroups, normalizeBookmarkTopicName, removeGlobalBookmarkMarkings, type ImportableBookmarkCatalog } from "../lib/shared-bookmarks.ts";

const catalog: ImportableBookmarkCatalog = {
  topics: [
    { id: "prayer", name: "Effective Prayer", color: "#93c5fd", aliases: ["Prayer", "Communing with God"], verses: [[43, 3, 16], [19, 23, 1]] },
    { id: "grace", name: "Grace", color: "#bbf7d0", aliases: ["Undeserved favour"], verses: [[43, 3, 16]] },
    { id: "gods-judgment", name: "God's Judgment", color: "#fb7185", verses: [] },
  ],
  locales: { af: { topics: { prayer: "Doeltreffende gebed", grace: "Genade" } }, fr: { topics: { grace: "Grâce" } } },
};

const personal: Marking = {
  id: "personal-id", passage: { translation: "aov", book: 43, chapter: 3 },
  verse: 16, start: null, end: null, quote: "My own quote", reference: "Johannes 3:16",
  colorId: "my-prayer-id", createdAt: 10,
};

test("new users receive localized global topics as empty groups with stable topic IDs", () => {
  const colors = bookmarkDefaultColors(catalog, "AF_na");
  assert.deepEqual(colors.map((color) => [color.id, color.name, color.source?.topicId]), [
    ["getbible-topic:prayer", "Doeltreffende gebed", "prayer"],
    ["getbible-topic:grace", "Genade", "grace"],
    ["getbible-topic:gods-judgment", "God's Judgment", "gods-judgment"],
  ]);
  const filled = importBookmarkCatalog(colors, [], catalog, "KJV", "af", 100);
  assert.deepEqual(filled.colors, colors);
  assert.equal(filled.markings.length, 3);
  assert.equal(filled.markings.every(isSharedBookmarkMarking), true);
});

test("migration previews are pure and use canonical names, aliases and every catalog locale", () => {
  const colors: MarkingColor[] = [
    { id: "my-prayer-id", name: "PRAYER", value: "#ffaa00" },
    { id: "my-grace", name: "gracé", value: "#aabbcc" },
    { id: "old-gods-judgment", name: " Gods’   judgment ", value: "#ddeeff" },
    { id: "unmatched", name: "My family", value: "#123456" },
  ];
  const snapshot = JSON.stringify(colors);
  const preview = bookmarkMigrationPreview(colors, catalog, "af");
  assert.equal(preview.matchingGroups, 3);
  assert.equal(preview.retainedGroups, 1);
  assert.equal(preview.addedGroups, 0);
  assert.equal(preview.mergedGroups, 0);
  assert.equal(JSON.stringify(colors), snapshot);
  assert.equal(normalizeBookmarkTopicName(" God's — Judgment "), normalizeBookmarkTopicName("godsjudgment"));
  assert.equal(bookmarkMigrationPreview([{ id: "fr", name: "Grâce", value: "#abcdef" }], catalog, "en").matchingGroups, 1);
  assert.equal(bookmarkMigrationPreview([{ id: "af", name: "Genade", value: "#abcdef" }], catalog, "en").matchingGroups, 1);
});

test("migration merges earlier imports into matching personal topics while retaining custom data", () => {
  const previousImport = importBookmarkTopic(catalog.topics[0], "kjv", "en", 100);
  const legacyShared = previousImport.markings.map((marking) => ({ ...marking, source: undefined }));
  const colors = [
    ...previousImport.colors,
    { id: "my-prayer-id", name: "Prayer", value: "#ffaa00" },
    { id: "unmatched", name: "My family", value: "#123456" },
  ];
  const unmatchedMark = { ...personal, id: "family", colorId: "unmatched" };
  const wordMark = { ...personal, id: "word", start: 0, end: 3, quote: "For" };
  const migration = migrateBookmarkGroups(colors, [personal, wordMark, unmatchedMark, ...legacyShared], catalog, "en");
  assert.equal(migration.colors.length, 4);
  assert.deepEqual(migration.colors[0], { id: "my-prayer-id", name: "Prayer", value: "#ffaa00", source: { type: "shared-bookmark", topicId: "prayer" } });
  assert.equal(migration.colorIdMap[previousImport.colors[0].id], "my-prayer-id");
  assert.equal(migration.colorIdMap["my-prayer-id"], "my-prayer-id");
  assert.equal(migration.markings[0], personal);
  assert.equal(migration.markings[1], wordMark);
  assert.equal(migration.markings[2], unmatchedMark);
  assert.equal(migration.markings.filter(isSharedBookmarkMarking).length, 2);
  assert.equal(migration.markings.filter(isSharedBookmarkMarking).every((marking) => marking.colorId === "my-prayer-id"), true);
  assert.deepEqual(migration.markings.filter(isSharedBookmarkMarking).map((marking) => marking.id), legacyShared.map((marking) => marking.id));
  assert.equal(isSharedBookmarkMarking(migration.markings[0]), false);
  const repeat = migrateBookmarkGroups(migration.colors, migration.markings, catalog, "af");
  assert.deepEqual(repeat.colors, migration.colors);
  assert.deepEqual(repeat.markings, migration.markings);
});

test("full downloads fill existing groups, retain personal markings, and remain duplicate-free across locales", () => {
  const colors = [{ id: "my-prayer-id", name: "Prayer", value: "#ffaa00" }];
  const first = importBookmarkCatalog(colors, [personal], catalog, "kjv", "en", 100);
  assert.equal(first.colors.find((color) => color.source?.topicId === "prayer")?.id, "my-prayer-id");
  assert.equal(first.colors.length, catalog.topics.length);
  assert.equal(first.markings.length, 4);
  assert.equal(first.markings[0], personal);
  assert.equal(first.markings.filter((marking) => marking.passage.book === 43).length, 3);
  const again = importBookmarkCatalog(first.colors, first.markings, catalog, "aov", "af", 200);
  assert.deepEqual(again.colors, first.colors);
  assert.deepEqual(again.markings, first.markings);
  const cleared = withoutWholeVerseMarking(again.markings, personal.passage, 16);
  assert.equal(cleared.filter(isSharedBookmarkMarking).length, 3);
  assert.equal(cleared.some((marking) => marking.id === personal.id), false);
});

test("source IDs preserve topic identity after a user renames a group", () => {
  const renamed: MarkingColor = { id: "custom-id", name: "Grace", value: "#ffaa00", source: { type: "shared-bookmark", topicId: "prayer" } };
  const imported = importBookmarkCatalog([renamed], [], catalog, "kjv", "en", 100);
  assert.equal(imported.colors.filter((color) => color.source?.topicId === "prayer").length, 1);
  assert.equal(imported.colors[0].id, renamed.id);
  assert.equal(imported.markings.filter((marking) => marking.colorId === renamed.id).length, 2);
  assert.equal(imported.colors.find((color) => color.source?.topicId === "grace")?.id, "getbible-topic:grace");
});

test("multiple matching local groups keep every personal marking and collapse repeated global memberships", () => {
  const localColors = [
    { id: "my-prayer-id", name: "Prayer", value: "#ffaa00" },
    { id: "second", name: "Effective Prayer", value: "#abcdef" },
  ];
  const imported = importBookmarkTopic(catalog.topics[0], "kjv", "en", 100);
  const shared = { ...imported.markings[0], colorId: "my-prayer-id" };
  const globalDuplicate = { ...shared, id: "duplicate-shared", colorId: "second" };
  const otherPersonal = { ...personal, id: "other-personal", colorId: "second", quote: "Another quote" };
  const preview = bookmarkMigrationPreview(localColors, catalog, "en");
  assert.equal(preview.mergedGroups, 1);
  const migration = migrateBookmarkGroups(localColors, [personal, otherPersonal, shared, globalDuplicate], catalog, "en");
  assert.equal(migration.colorIdMap.second, "my-prayer-id");
  assert.equal(migration.markings.length, 3);
  assert.deepEqual(migration.markings.filter((marking) => !isSharedBookmarkMarking(marking)).map((marking) => [marking.id, marking.quote]), [[personal.id, personal.quote], [otherPersonal.id, otherPersonal.quote]]);
  assert.equal(migration.markings.filter(isSharedBookmarkMarking).length, 1);
});

test("ambiguous aliases and unavailable source IDs never absorb an unrelated local group", () => {
  const ambiguous = { topics: catalog.topics.map((topic) => ({ ...topic, aliases: ["Common"] })) };
  const colors: MarkingColor[] = [
    { id: "ambiguous", name: "Common", value: "#abcdef" },
    { id: "unknown", name: "Grace", value: "#123456", source: { type: "shared-bookmark", topicId: "removed-topic" } },
  ];
  const preview = bookmarkMigrationPreview(colors, ambiguous, "en");
  assert.equal(preview.retainedGroups, 2);
  assert.equal(preview.matchingGroups, 0);
  assert.equal(migrateBookmarkGroups(colors, [], ambiguous, "en").colors.length, 5);
});

test("catalog validation prevents partial imports and backup metadata survives non-global group IDs", () => {
  const colors = [{ id: "my-prayer-id", name: "Prayer", value: "#ffaa00" }];
  const before = JSON.stringify({ colors, markings: [personal] });
  const invalid = { ...catalog, topics: [catalog.topics[0], { ...catalog.topics[1], verses: [[67, 1, 1] as [number, number, number]] }] };
  assert.throws(() => importBookmarkCatalog(colors, [personal], invalid, "kjv", "en"), /invalid Scripture coordinates/);
  assert.equal(JSON.stringify({ colors, markings: [personal] }), before);
  assert.throws(() => importBookmarkCatalog(colors, [personal], { topics: [catalog.topics[0], catalog.topics[0]] }, "kjv", "en"), /duplicate topics/);
  const imported = importBookmarkCatalog(colors, [personal], catalog, "kjv", "en", 100);
  const backup = { version: 2 as const, exportedAt: "2026-10-08T00:00:00Z", colors: imported.colors, markings: imported.markings, notes: [{ id: "note", passage: personal.passage, verse: 16, reference: "John 3:16", text: "My note", createdAt: 1, updatedAt: 2 }] };
  assert.deepEqual(parseMarkingsBackup(JSON.parse(JSON.stringify(backup))), backup);
  const legacy = { version: 1, exportedAt: "2026-10-08T00:00:00Z", colors, markings: [personal] };
  assert.deepEqual(parseMarkingsBackup(legacy), legacy);
});

test("unavailable topic IDs and existing groups cannot overwrite each other's IDs", () => {
  const orphan: MarkingColor = { id: "getbible-topic:prayer", name: "Old collection", value: "#abcdef", source: { type: "shared-bookmark", topicId: "removed-topic" } };
  const imported = importBookmarkCatalog([orphan], [], catalog, "kjv", "en", 100);
  assert.equal(new Set(imported.colors.map((color) => color.id)).size, imported.colors.length);
  assert.equal(imported.colors[0], orphan);
  const newGroup = imported.colors.find((color) => color.source?.topicId === "prayer")!;
  assert.notEqual(newGroup.id, orphan.id);
  assert.equal(imported.markings.filter((marking) => marking.colorId === newGroup.id).length, 2);
  assert.deepEqual(importBookmarkCatalog(imported.colors, imported.markings, catalog, "kjv", "en", 200).markings, imported.markings);
});

test("individual topic downloads fill matching groups and clear only global provenance", () => {
  const colors = [{ id: "my-prayer-id", name: "Prayer", value: "#ffaa00" }, { id: "private", name: "My family", value: "#123456" }];
  const topicImport = importBookmarkTopicIntoGroups(colors, [personal], catalog.topics[0], "kjv", "en", 100);
  assert.equal(topicImport.colors.length, 2);
  assert.equal(topicImport.colors[0].id, "my-prayer-id");
  assert.equal(topicImport.colors[1], colors[1]);
  assert.equal(topicImport.markings.length, 3);
  assert.deepEqual(removeGlobalBookmarkMarkings(topicImport.markings), [personal]);
  const all = importBookmarkCatalog(topicImport.colors, topicImport.markings, catalog, "kjv", "en", 200);
  const removePrayer = removeGlobalBookmarkMarkings(all.markings, "prayer");
  assert.equal(removePrayer.length, 2);
  assert.equal(removePrayer[0], personal);
  assert.equal(removePrayer[1].source?.topicId, "grace");
  assert.equal(all.colors[0].source?.topicId, "prayer");
  assert.deepEqual(removeGlobalBookmarkMarkings(all.markings, "unknown"), all.markings);
});

test("display rows unify personal and global whole verses without mutating their records", () => {
  const colors = [{ id: "my-prayer-id", name: "Prayer", value: "#ffaa00" }];
  const imported = importBookmarkTopicIntoGroups(colors, [personal], catalog.topics[0], "kjv", "en", 100);
  const before = JSON.stringify(imported.markings);
  const rows = bookmarkDisplayRows(imported.markings);
  assert.equal(rows.length, 2);
  const mixed = rows.find((row) => row.marking.verse === 16)!;
  assert.equal(mixed.marking, personal);
  assert.equal(mixed.global, true);
  assert.equal(mixed.personal, true);
  assert.deepEqual(new Set(mixed.ids), new Set([personal.id, "getbible-topic:prayer:43:3:16"]));
  assert.equal(JSON.stringify(imported.markings), before);
  const retained = bookmarkDisplayRows(removeGlobalBookmarkMarkings(imported.markings));
  assert.deepEqual(retained, [{ marking: personal, ids: [personal.id], global: false, personal: true }]);
  const removedIds = new Set(mixed.ids);
  assert.equal(imported.markings.filter((marking) => !removedIds.has(marking.id)).length, 1);
});

test("display rows prefer personal quotes and never combine selected words or other topics", () => {
  const shared = { ...importBookmarkTopic(catalog.topics[0], "kjv", "en", 100).markings[1], colorId: personal.colorId };
  const emptyPersonal = { ...personal, id: "without-quote", quote: "" };
  const otherGroup = { ...personal, id: "other-topic", colorId: "different-group" };
  const word = { ...personal, id: "word", start: 0, end: 3, quote: "For" };
  const secondWord = { ...word, id: "second-word" };
  const rows = bookmarkDisplayRows([shared, emptyPersonal, word, secondWord, personal, otherGroup]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].marking, personal);
  assert.equal(rows[0].global, true);
  assert.equal(rows[0].personal, true);
  assert.deepEqual(rows[0].ids, [shared.id, emptyPersonal.id, personal.id]);
  assert.equal(rows.filter((row) => row.marking.start !== null).length, 2);
  assert.equal(rows.some((row) => row.marking === otherGroup && row.ids.length === 1), true);
});

test("display rows retain Bible order and prioritize global origins only at the same coordinate", () => {
  const sameGlobal = { ...personal, id: "global-at-john", colorId: "global-topic", source: { type: "shared-bookmark" as const, topicId: "grace" }, createdAt: 100 };
  const before = { ...personal, id: "genesis", passage: { translation: "kjv", book: 1, chapter: 1 }, verse: 1 };
  const after = { ...sameGlobal, id: "revelation", passage: { translation: "kjv", book: 66, chapter: 1 }, verse: 1 };
  const rows = bookmarkDisplayRows([after, personal, sameGlobal, before]);
  assert.deepEqual(rows.map((row) => row.marking.id), ["genesis", "global-at-john", personal.id, "revelation"]);
});
