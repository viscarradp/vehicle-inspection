import axios from 'axios';
import type { ApiResponse } from '@/types';

export function getApiError(err: unknown): ApiResponse | null {
  if (axios.isAxiosError(err) && err.response?.data) {
    return err.response.data as ApiResponse;
  }
  return null;
}

export function isNotFound(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}
