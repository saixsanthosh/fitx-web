// next/server reads AsyncLocalStorage from globalThis when its modules load; Next's own runtime sets it.
import { AsyncLocalStorage } from "node:async_hooks";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
