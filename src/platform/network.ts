export interface PortableJsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface NetworkPort {
  isOnline(): boolean;
  fetchJson(url: string, init?: RequestInit): Promise<PortableJsonResponse>;
}

let activeNetworkPort: NetworkPort = createDefaultNetworkPort();

export function configureNetworkPort(port: NetworkPort): void {
  activeNetworkPort = port;
}

export function resetNetworkPort(): void {
  activeNetworkPort = createDefaultNetworkPort();
}

export function isNetworkOnline(): boolean {
  return activeNetworkPort.isOnline();
}

export function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<PortableJsonResponse> {
  return activeNetworkPort.fetchJson(url, init);
}

function createDefaultNetworkPort(): NetworkPort {
  return {
    isOnline() {
      return globalThis.navigator?.onLine !== false;
    },
    async fetchJson(url, init) {
      if (!globalThis.fetch) {
        return {
          ok: false,
          status: 0,
          json: async () => null,
        };
      }
      const response = await globalThis.fetch(url, init);
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
      };
    },
  };
}
