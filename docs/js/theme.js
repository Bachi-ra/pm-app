const STORAGE_KEY = 'theme';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function labelFor(theme) {
  return theme === 'dark' ? 'ライトモード' : 'ダークモード';
}

export function initThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  btn.textContent = labelFor(currentTheme());

  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {
      // localStorageが使えない環境では保存されないが、表示の切り替え自体は行う
    }
    btn.textContent = labelFor(next);
  });
}
