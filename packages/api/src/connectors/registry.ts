/**
 * Cloud connector registry — maps provider IDs to their adapter implementations.
 */
import type { CloudProvider } from "@edgebric/types";
import type { CloudConnectorAdapter } from "./types.js";

const adapters = new Map<CloudProvider, CloudConnectorAdapter>();

export function registerConnector(adapter: CloudConnectorAdapter): void {
  adapters.set(adapter.provider, adapter);
}

export function getConnector(provider: CloudProvider): CloudConnectorAdapter | undefined {
  return adapters.get(provider);
}

export function getRegisteredProviders(): CloudProvider[] {
  return [...adapters.keys()];
}
