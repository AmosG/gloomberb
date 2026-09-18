import { SHARED_SPECIFIERS, type SharedSpecifier } from "./host-contract";

type HostModuleImporter = () => Promise<object>;

/**
 * The host's canonical implementation for every public shared-module
 * specifier. Resolve Gloomberb's own modules relative to this file: a
 * Bun-compiled host has no filesystem package root from which
 * `import("gloomberb/ui")` can be resolved.
 */
const HOST_MODULE_IMPORTERS = {
  "react": () => import("react"),
  "react/jsx-runtime": () => import("react/jsx-runtime"),
  "react/jsx-dev-runtime": () => import("react/jsx-dev-runtime"),
  "gloomberb/types/plugin": () => import("../types/plugin"),
  "gloomberb/types/persistence": () => import("../types/persistence"),
  "gloomberb/types/broker": () => import("../types/broker"),
  "gloomberb/types/config": () => import("../types/config"),
  "gloomberb/types/data-provider": () => import("../types/data-provider"),
  "gloomberb/types/financials": () => import("../types/financials"),
  "gloomberb/types/instrument": () => import("../types/instrument"),
  "gloomberb/types/ticker": () => import("../types/ticker"),
  "gloomberb/types/trading": () => import("../types/trading"),
  "gloomberb/ui": () => import("../ui"),
  "gloomberb/components": () => import("../components"),
  "gloomberb/theme": () => import("../theme/colors"),
  "gloomberb/capabilities": () => import("../capabilities"),
  "gloomberb/utils": () => import("../public/utils"),
  "gloomberb/react": () => import("../public/react"),
  "gloomberb/broker": () => import("../public/broker"),
  "gloomberb/dialog": () => import("../ui/dialog"),
  "gloomberb/market-data": () => import("../public/market-data"),
  "gloomberb/time-series": () => import("../public/time-series"),
  "gloomberb/layout": () => import("../public/layout"),
  "gloomberb/quotes": () => import("../public/quotes"),
  "gloomberb/tickers": () => import("../public/tickers"),
  "gloomberb/i18n": () => import("../public/i18n"),
} satisfies Record<SharedSpecifier, HostModuleImporter>;

/**
 * Public exports the host serves to plugins running in its own Bun process,
 * but never to a browser renderer: `gloomberb/remote` reads the data
 * directory, so a renderer bundle that imports it is meant to fail to compile.
 */
export const NATIVE_HOST_MODULE_IMPORTERS: Readonly<Record<string, HostModuleImporter>> = {
  "gloomberb/remote": () => import("../public/remote"),
};

/**
 * Every specifier the Bun process can hand a plugin directly, shared and
 * native alike. This is what the runtime resolver publishes when the host has
 * no package directory for a symlink to point at.
 */
export const PLUGIN_HOST_RESOLVER_IMPORTERS: Readonly<Record<string, HostModuleImporter>> = {
  ...HOST_MODULE_IMPORTERS,
  ...NATIVE_HOST_MODULE_IMPORTERS,
};

/** Import one host module without depending on bare Gloomberb package resolution. */
export async function importPluginHostModule(specifier: string): Promise<object> {
  if (!(SHARED_SPECIFIERS as readonly string[]).includes(specifier)) {
    throw new Error(`Unknown plugin host module: ${specifier}`);
  }
  return HOST_MODULE_IMPORTERS[specifier as SharedSpecifier]();
}

/** Import the complete registry from the same map used by the bundler. */
export async function importAllPluginHostModules(): Promise<Readonly<Record<SharedSpecifier, object>>> {
  const entries = await Promise.all(
    SHARED_SPECIFIERS.map(async (specifier) => [specifier, await importPluginHostModule(specifier)] as const),
  );
  return Object.fromEntries(entries) as Record<SharedSpecifier, object>;
}
