import { AsyncLocalStorage } from 'node:async_hooks';
export const taskContext = new AsyncLocalStorage();
export function checkTask() { taskContext.getStore()?.signal?.throwIfAborted(); }
