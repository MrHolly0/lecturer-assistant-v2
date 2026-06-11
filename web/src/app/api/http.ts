import { clearStoredAuth, getStoredAuth } from '../auth';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (auth) {
    headers['Authorization'] = `Bearer ${auth.accessToken}`;
  }
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (response.status === 401) {
    clearStoredAuth();
    window.location.hash = '#/login';
    throw new ApiError(401, 'Сессия истекла');
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Запрос завершился с ошибкой ${response.status}`);
  }
  return response;
}
