import { captureMessengerLaunch } from "./launch-data";
// Launch credentials stay in memory, never localStorage or a navigation URL.
const captured = captureMessengerLaunch(window.location.href);
export const messengerLaunch = captured.launch;
if (captured.cleanUrl !== window.location.href)
  window.history.replaceState(null, "", captured.cleanUrl);
