import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const fromVite = createRequire(require.resolve("vite/package.json"));
const fromGlob = createRequire(fromVite.resolve("tinyglobby"));
const fromDirectory = createRequire(fromGlob.resolve("fdir"));

test("build tools use the guarded parser and retain normal source matching", () => {
  const buildMatcher = require.resolve("../vendor/build-picomatch");
  for (const consumer of [fromVite, fromGlob, fromDirectory]) {
    assert.equal(consumer.resolve("picomatch"), buildMatcher);
    const match = consumer("picomatch");
    assert.ok(match("src/**/*.{ts,tsx}")("src/pages/Home.tsx"));
    assert.ok(!match("src/**/*.{ts,tsx}")("src/styles.css"));
    for (const pattern of ["src/+(unit).ts", "src/*(unit).ts"]) {
      assert.throws(() => match.makeRe(pattern), /Repeated extglobs are disabled/);
    }
  }
});
