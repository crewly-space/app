import { CrewlyClient } from '@crewly/sdk';

const TOKEN_KEY = 'crewly:session';
export const client = new CrewlyClient({ baseUrl: window.location.origin });
export function currentToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  client.setToken(token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  client.setToken(undefined);
  window.dispatchEvent(new Event('crewly:logout'));
}
const token = currentToken();
if (token) client.setToken(token);
