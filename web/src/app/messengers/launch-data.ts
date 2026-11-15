export interface MessengerLaunch {
  channel: "telegram" | "vk";
  initData: string;
}

export function captureMessengerLaunch(href: string): {
  launch: MessengerLaunch | null;
  cleanUrl: string;
} {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.startsWith("#/") ? "" : url.hash.slice(1));
  const telegram = fragment.get("tgWebAppData") ?? url.searchParams.get("tgWebAppData");
  let launch: MessengerLaunch | null = telegram
    ? { channel: "telegram", initData: telegram }
    : null;
  if (!launch && url.searchParams.has("vk_app_id") && url.searchParams.has("sign")) {
    const signed = new URLSearchParams();
    url.searchParams.forEach((value, key) => {
      if (key.startsWith("vk_") || key === "sign") signed.append(key, value);
    });
    launch = { channel: "vk", initData: signed.toString() };
  }
  const keys = [...url.searchParams.keys()];
  for (const key of keys)
    if (key.startsWith("vk_") || key === "sign" || key.startsWith("tgWebApp"))
      url.searchParams.delete(key);
  if (fragment.has("tgWebAppData")) url.hash = "";
  return { launch, cleanUrl: url.toString() };
}
