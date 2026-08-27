const KEY = 'pmapp_current_member_id';

export function getCurrentMemberId() {
  return localStorage.getItem(KEY);
}

export function setCurrentMemberId(id) {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
}
