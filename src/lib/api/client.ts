import { OpenCrewClient } from '@opencrew/sdk';

const TOKEN_KEY = 'opencrew:session';
export const client = new OpenCrewClient({ baseUrl: window.location.origin });
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
  window.dispatchEvent(new Event('opencrew:logout'));
}
const token = currentToken();
if (token) client.setToken(token);
