export type HelperContext = { courseId: string; sessionId: string; controlToken: string };
let context: HelperContext | null = null;
export function helperContext(): HelperContext | null {
  return context;
}
export function readHelperContext(hash: string): HelperContext | null {
  const [route, query, extra] = hash.split("?");
  if (route !== "#/helper/remote" || !query || extra) return null;
  const params = new URLSearchParams(query);
  if ([...params.keys()].length !== 3) return null;
  const courseId = params.get("courseId") ?? "";
  const sessionId = params.get("sessionId") ?? "";
  const controlToken = params.get("controlToken") ?? "";
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (
    !uuid.test(courseId) ||
    !uuid.test(sessionId) ||
    !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(controlToken) ||
    !uuid.test(controlToken.slice(0, 36))
  )
    return null;
  return { courseId, sessionId, controlToken };
}
export function configureHelperContext(value: HelperContext): void {
  context = value;
}
