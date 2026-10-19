import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// Bundle the production publisher, not a second implementation of the encoder.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { build } = require("esbuild");
const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) {
  throw new Error("An absolute fixture HTML destination is required");
}
const result = await build({
  entryPoints: [resolve(root, "projector-agent/scripts/video-publisher-fixture.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome132",
  define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" }
});
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination,
  '<!doctype html><html><meta charset="utf-8"><title>Own video publisher fixture</title>' +
  '<style>body{font:16px system-ui;background:#fff;color:#111}canvas,video{width:320px;height:180px}</style>' +
  '<h1>Own canvas → production publisher → MSE</h1><canvas id="source" width="320" height="180"></canvas>' +
  '<video id="decoded" muted playsinline></video><canvas id="pixels" width="320" height="180" hidden></canvas>' +
  '<script>' + script + '</script></html>', { flag: "wx" });
console.log("Production publisher fixture bundled");
