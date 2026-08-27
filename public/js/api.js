import { getCurrentMemberId } from './state.js';

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const memberId = getCurrentMemberId();
  if (memberId) headers['X-Acting-Member-Id'] = memberId;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `エラーが発生しました (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch (_) {
      /* ignore parse errors */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getMembers: () => request('/api/members'),
  createMember: (data) => request('/api/members', { method: 'POST', body: data }),
  updateMember: (id, data) => request(`/api/members/${id}`, { method: 'PUT', body: data }),
  deleteMember: (id) => request(`/api/members/${id}`, { method: 'DELETE' }),

  getTasks: () => request('/api/tasks'),
  createTask: (data) => request('/api/tasks', { method: 'POST', body: data }),
  updateTask: (id, data) => request(`/api/tasks/${id}`, { method: 'PUT', body: data }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  getMilestones: () => request('/api/milestones'),
  createMilestone: (data) => request('/api/milestones', { method: 'POST', body: data }),
  updateMilestone: (id, data) => request(`/api/milestones/${id}`, { method: 'PUT', body: data }),
  deleteMilestone: (id) => request(`/api/milestones/${id}`, { method: 'DELETE' }),
};
