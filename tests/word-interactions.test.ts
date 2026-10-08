import assert from "node:assert/strict";
import test from "node:test";
import { createWordActivation } from "../lib/word-interactions.ts";

test("single-click study waits while double/triple-click remain native selections", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let activations = 0;
  const words = createWordActivation(() => false);
  const activate = () => { activations += 1; };
  words.click(1, activate);
  context.mock.timers.tick(259);
  assert.equal(activations, 0);
  context.mock.timers.tick(1);
  assert.equal(activations, 1);
  words.click(1, activate);
  context.mock.timers.tick(180);
  words.click(2, activate);
  words.click(3, activate);
  context.mock.timers.tick(1_000);
  assert.equal(activations, 1);
});

test("selection completed after pointer click suppresses deferred study activation", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let selected = false;
  let activations = 0;
  const words = createWordActivation(() => selected);
  words.click(1, () => { activations += 1; });
  selected = true;
  context.mock.timers.tick(260);
  assert.equal(activations, 0);
  words.click(1, () => { activations += 1; });
  selected = false;
  context.mock.timers.tick(260);
  assert.equal(activations, 0);
});

test("keyboard study is immediate and cancels any pending pointer action", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const activations: string[] = [];
  const words = createWordActivation(() => false);
  words.click(1, () => activations.push("pointer"));
  words.keyboard(() => activations.push("keyboard"));
  assert.deepEqual(activations, ["keyboard"]);
  context.mock.timers.tick(1_000);
  assert.deepEqual(activations, ["keyboard"]);
});

test("focus loss or unmount cancels deferred study and assistive clicks stay immediate", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let activations = 0;
  const words = createWordActivation(() => false);
  words.click(1, () => { activations += 1; });
  words.cancel();
  context.mock.timers.tick(1_000);
  assert.equal(activations, 0);
  words.click(0, () => { activations += 1; });
  assert.equal(activations, 1);
});
