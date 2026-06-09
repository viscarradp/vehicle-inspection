import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Emits 'unauthorized' when any response returns 401.
// AuthContext listens to this event and clears the user — React Router
// then redirects to /login naturally, without a hard page reload.
export const authEvents = new EventTarget();

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      authEvents.dispatchEvent(new Event('unauthorized'));
    }
    return Promise.reject(error);
  },
);
