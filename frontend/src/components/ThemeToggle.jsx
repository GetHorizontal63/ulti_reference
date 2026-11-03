import React from 'react';
import { useTheme } from '../hooks/useTheme.jsx';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  // On dark: white chip. On light: dark chip.
  const bg     = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(58,26,8,0.10)';
  const border = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(58,26,8,0.22)';
  const color  = isDark ? '#fff'                   : 'var(--text-dark)';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 99,
        padding: '4px 10px',
        cursor: 'pointer',
        color,
        fontFamily: 'var(--font-h2)',
        fontSize: 9,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        outline: 'none',
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>{isDark ? '☀' : '◑'}</span>
      {isDark ? 'Light' : 'Dark'}
    </button>
  );
}
