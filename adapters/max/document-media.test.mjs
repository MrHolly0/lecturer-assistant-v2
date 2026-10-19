import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocumentUploader } from "./document-media.mjs";

const ref = "/internal/v1/channels/max/media/" + "a".repeat(43);
const bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
function fixture({ sourceStatus = () => 200, contentType = "image/jpeg", data = bytes,
  target = "https://upload.example/signed", disposition = 'attachment; filename="demonstration-20261019T150000Z.jpg"' } = {}) {
  const downloads = [], uploads = [], allocations = [];
  const upload = createDocumentUploader({
    coreUrl: "http://core:8080", apiKey: "private-key", apiBase: "https://platform-api2.max.ru",
    maxApi: async (path, options) => {
      allocations.push({ path, options });
      return { url: target };
    },
    fetchImpl: async (url, options) => {
      if (new URL(url).host === "core:8080") {
        downloads.push(options);
        return new Response(data, { status: sourceStatus(), headers: {
          "content-type": contentType,
          "content-disposition": disposition,
        } });
      }
      uploads.push({ url, options });
      return Response.json({ token: "processed-file-token" });
    },
  });
  return { upload, downloads, uploads, allocations };
}

test("document upload preserves bytes and filename and never forwards private keys to the upload host", async () => {
  const f = fixture();
  assert.equal(await f.upload(ref), "processed-file-token");
  assert.deepEqual(f.allocations, [{ path: "/uploads", options: { method: "POST", query: { type: "file" } } }]);
  const file = f.uploads[0].options.body.get("data");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.equal(file.name, "demonstration-20261019T150000Z.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(f.uploads[0].options.headers, undefined);
  assert.equal(f.downloads[0].headers["X-Internal-Api-Key"], "private-key");
  assert.equal(f.downloads[0].redirect, "error");
  assert.equal(f.uploads[0].options.redirect, "error");
});

test("an unexpected source filename uses a safe JPEG filename", async () => {
  const f = fixture({ disposition: 'attachment; filename="../../private.txt"' });
  await f.upload(ref);
  assert.equal(f.uploads[0].options.body.get("data").name, "demonstration.jpg");
});

test("retry reuses processed MAX token but revalidates private media binding before every send", async () => {
  let status = 200;
  const f = fixture({ sourceStatus: () => status });
  await f.upload(ref);
  await f.upload(ref);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.downloads.length, 2);
  status = 410;
  await assert.rejects(f.upload(ref), /410/);
  assert.equal(f.uploads.length, 1);
});

test("rejects arbitrary URLs, path traversal, queries and malformed opaque media references before fetch", async () => {
  const f = fixture();
  for (const invalid of ["https://evil.example/frame.jpg", "//evil.example/x", ref + "?x=1",
    "/internal/v1/channels/max/media/../private", ref.slice(0, -1), null]) {
    await assert.rejects(f.upload(invalid), /Unsupported private document reference/);
  }
  assert.equal(f.downloads.length, 0);
  assert.equal(f.allocations.length, 0);
});

test("rejects oversized or non-JPEG core files and unsafe MAX upload destinations", async () => {
  for (const options of [{ data: new Uint8Array(256 * 1024 + 1) }, { contentType: "text/html" },
    { target: "http://upload.example/unsafe" }, { target: "https://user:password@upload.example/x" }]) {
    const f = fixture(options);
    await assert.rejects(f.upload(ref));
    assert.equal(f.uploads.length, 0);
  }
});
