import { apiFetch } from "./http";

export interface ChannelJoinConfig {
  telegramBot: string | null;
  vkBot: string | null;
}

export async function getChannelConfig(): Promise<ChannelJoinConfig> {
  const res = await apiFetch("/config/channels");
  return res.json() as Promise<ChannelJoinConfig>;
}
