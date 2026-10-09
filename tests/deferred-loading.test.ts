import assert from "node:assert/strict";
import test from "node:test";
import { deferLoading } from "../lib/deferred-loading.ts";

test("an immediate cached passage finishes before the loading indicator starts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const states: boolean[] = [];
  const loading = deferLoading(() => states.push(true), () => states.push(false));
  await Promise.resolve("cached passage");
  loading.finish();
  context.mock.timers.tick(1);
  assert.deepEqual(states, [false]);
});

test("a slow passage shows loading then settles exactly once", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const states: boolean[] = [];
  const loading = deferLoading(() => states.push(true), () => states.push(false));
  context.mock.timers.tick(1);
  assert.deepEqual(states, [true]);
  loading.finish();
  loading.finish();
  context.mock.timers.tick(1_000);
  assert.deepEqual(states, [true, false]);
});

test("a superseded passage cannot start loading or clear a newer passage's indicator", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const states: string[] = [];
  const old = deferLoading(() => states.push("old start"), () => states.push("old finish"));
  old.cancel();
  const current = deferLoading(() => states.push("current start"), () => states.push("current finish"));
  context.mock.timers.tick(1);
  old.finish();
  assert.deepEqual(states, ["current start"]);
  current.finish();
  assert.deepEqual(states, ["current start", "current finish"]);
});

test("unmounting an already loading passage suppresses its late completion", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const states: boolean[] = [];
  const loading = deferLoading(() => states.push(true), () => states.push(false));
  context.mock.timers.tick(1);
  loading.cancel();
  loading.finish();
  assert.deepEqual(states, [true]);
});
