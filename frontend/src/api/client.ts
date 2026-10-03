import axios from 'axios';
import { showNotice } from './notice';

// Production uses the relative "/api" (from .env.production), so the same
// build works on any domain (production, staging) and inside the desktop
// and Android apps, which load the live site. In dev it falls back to the
// local NestJS server.
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('erp_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // A page couldn't load something this user isn't allowed to see:
    // say so instead of silently showing an empty page. (Actions like
    // Save/Delete already show the server's message themselves.)
    if (err?.response?.status === 403 && (err.config?.method || 'get').toLowerCase() === 'get') {
      showNotice(err.response.data?.message || "You don't have permission to view this.");
    }
    if (err?.response?.status === 401) {
      localStorage.removeItem('erp_token');
      localStorage.removeItem('erp_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export default api;
