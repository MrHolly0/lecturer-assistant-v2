/** Resolve Vite-style extensionless TypeScript imports in Node's strip-types test runner. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") || /\.[a-zA-Z0-9]+$/.test(specifier)) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
