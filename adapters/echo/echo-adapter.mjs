#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const coreUrl = process.env.CORE_URL ?? "http://localhost:8080";
const apiKey = process.env.CHANNEL_INTERNAL_API_KEY ?? "phase-4-local-channel-key";
const channelType = "echo";

async function request(path, options = {}) {
  const response = await fetch(`${coreUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": apiKey,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined;
  }
  return response.json();
}

async function registerCapabilities() {
  await request(`/internal/v1/channels/${channelType}/capabilities`, {
    method: "PUT",
    body: JSON.stringify({
      inlineButtons: true,
      editMessage: true,
      images: true,
      maxTextLength: 4096,
      maxButtonsPerRow: 4,
    }),
  });
}

async function inbound(externalUserId, text) {
  await request(`/internal/v1/channels/${channelType}/inbound`, {
    method: "POST",
    body: JSON.stringify({
      externalUserId,
      kind: text.startsWith("/") ? "COMMAND" : "TEXT",
      text,
      displayHint: externalUserId,
      occurredAt: new Date().toISOString(),
    }),
  });
}

async function pollOnce() {
  const batch = await request(`/internal/v1/channels/${channelType}/outbox?wait=1s&limit=100`);
  const messages = batch.messages ?? [];
  for (const message of messages) {
    output.write(`[${message.externalUserId}] ${message.content.text ?? message.content.ref ?? ""}\n`);
  }
  if (messages.length > 0) {
    await request(`/internal/v1/channels/${channelType}/delivery-reports`, {
      method: "POST",
      body: JSON.stringify({
        reports: messages.map((message) => ({
          messageId: message.id,
          status: "DELIVERED",
          adapterMessageId: `echo:${message.id}`,
          latencyMs: 0,
        })),
      }),
    });
  }
}

await registerCapabilities();
output.write("Echo adapter ready. Use: in <externalUserId> <text>, poll, quit\n");

const rl = readline.createInterface({ input, output });
for (;;) {
  const line = (await rl.question("> ")).trim();
  if (line === "quit") {
    break;
  }
  if (line === "poll") {
    await pollOnce();
    continue;
  }
  if (line.startsWith("in ")) {
    const [, externalUserId, ...textParts] = line.split(" ");
    await inbound(externalUserId, textParts.join(" "));
    continue;
  }
  output.write("Unknown command\n");
}

rl.close();
