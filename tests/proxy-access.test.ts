import { expect, it } from 'vitest';
import type { Connect } from 'vite';
import { isLocalRequest } from '../src/server/middleware.ts';
function request(host: string, origin?: string, user?: string, address='127.0.0.1') {
  return { headers: {host,origin,'tailscale-user-login':user}, socket:{remoteAddress:address} } as unknown as Connect.IncomingMessage;
}
it('retains localhost access and refuses foreign origins', () => {
 expect(isLocalRequest(request('localhost:4321','http://localhost:4321'))).toBe(true);
 expect(isLocalRequest(request('localhost:4321','https://foreign.example'))).toBe(false);
});
it('permits only an explicitly configured proxy identity with a same-origin HTTPS request', () => {
 const owner='owner@example.test';
 expect(isLocalRequest(request('work.example:18000','https://work.example:18000',owner),owner)).toBe(true);
 expect(isLocalRequest(request('work.example:18000',undefined,owner),owner)).toBe(true);
 expect(isLocalRequest(request('work.example:18000','https://work.example:18000',owner))).toBe(false);
 expect(isLocalRequest(request('work.example:18000','https://work.example:18000','another'),owner)).toBe(false);
 expect(isLocalRequest(request('work.example:18000','https://foreign.example',owner),owner)).toBe(false);
 expect(isLocalRequest(request('work.example:18000','http://work.example:18000',owner),owner)).toBe(false);
 expect(isLocalRequest(request('work.example:18000',undefined,owner,'192.0.2.1'),owner)).toBe(false);
});
