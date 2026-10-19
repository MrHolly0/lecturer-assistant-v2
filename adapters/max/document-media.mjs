const PRIVATE_MEDIA = /^\/internal\/v1\/channels\/max\/media\/[A-Za-z0-9_-]{43}$/;
const MAX_BYTES = 256 * 1024;
const TTL_MS = 10 * 60 * 1000;

/** Only core-issued private media references are accepted; no user-selected download URLs. */
export function createDocumentUploader({ coreUrl, apiKey, apiBase, maxApi, fetchImpl = fetch, now = Date.now }) {
  const uploaded = new Map();
  return async function uploadDocument(ref) {
    if (typeof ref !== "string" || !PRIVATE_MEDIA.test(ref)) {
      throw new Error("Unsupported private document reference");
    }
    for (const [key, value] of uploaded) {
      if (value.expiresAt <= now()) uploaded.delete(key);
    }
    const cached = uploaded.get(ref);

    const source = new URL(ref, coreUrl);
    if (source.origin !== new URL(coreUrl).origin) throw new Error("Invalid core media origin");
    const response = await fetchImpl(source, {
      headers: { "X-Internal-Api-Key": apiKey, Accept: "image/jpeg" },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Private media download failed: ${response.status}`);
    if (response.headers.get("content-type")?.split(";")[0] !== "image/jpeg") {
      throw new Error("Private document is not a JPEG frame");
    }
    if (cached) {
      // Revalidate the binding even for a processed file; account revocation must stop a retry.
      await response.body?.cancel();
      return cached.token;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > MAX_BYTES) throw new Error("Private document is too large");
      chunks.push(chunk);
    }
    if (!length) throw new Error("Private document is empty");
    const filename = response.headers.get("content-disposition")
      ?.match(/filename="?(demonstration-\d{8}T\d{6}Z\.jpg)"?/)?.[1] ?? "demonstration.jpg";
    const allocation = await maxApi("/uploads", { method: "POST", query: { type: "file" } });
    const target = new URL(allocation.url);
    const api = new URL(apiBase);
    const localTest = api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)
      && target.origin === api.origin;
    if (target.username || target.password || (target.protocol !== "https:" && !localTest)) {
      throw new Error("Invalid MAX file upload URL");
    }
    const form = new FormData();
    form.append("data", new Blob(chunks, { type: "image/jpeg" }), filename);
    // The MAX-issued upload URL is signed; never forward the bot or core API key to that host.
    const upload = await fetchImpl(target, {
      method: "POST",
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!upload.ok) throw new Error(`MAX file upload failed: ${upload.status}`);
    const result = await upload.json();
    if (typeof result.token !== "string" || !result.token || result.token.length > 4096) {
      throw new Error("MAX file upload did not return a token");
    }
    // An outbox retry reuses the uploaded token if MAX has not finished processing the file yet.
    if (uploaded.size >= 1024) uploaded.delete(uploaded.keys().next().value);
    uploaded.set(ref, { token: result.token, expiresAt: now() + TTL_MS });
    return result.token;
  };
}
