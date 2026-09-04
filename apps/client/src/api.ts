import type { AuthResponse, CharacterSummary, ClassId } from '@worldofchatgpt/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const jsonRequest = async <T>(path: string, options: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
};

export const register = (username: string, password: string): Promise<AuthResponse> =>
  jsonRequest('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });

export const login = (username: string, password: string): Promise<AuthResponse> =>
  jsonRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const getMe = async (token: string): Promise<CharacterSummary | null> => {
  const result = await jsonRequest<{ character: CharacterSummary | null }>('/me', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  return result.character;
};

export const createCharacter = async (token: string, name: string, classId: ClassId): Promise<CharacterSummary> => {
  const result = await jsonRequest<{ character: CharacterSummary }>('/characters', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, classId }),
  });
  return result.character;
};
