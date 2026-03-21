/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0a0f',
          secondary: '#0f0f1a',
          tertiary: '#141420',
          card: '#16162a',
          hover: '#1c1c30',
        },
        border: {
          DEFAULT: '#1e1e3a',
          light: '#2a2a4a',
        },
        accent: {
          green: '#00d4aa',
          red: '#ff4757',
          blue: '#4c9eff',
          purple: '#9945ff',
          yellow: '#ffd700',
          orange: '#ff8c00',
        },
        text: {
          primary: '#e8e8f0',
          secondary: '#8888aa',
          muted: '#555570',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-green': 'pulseGreen 2s ease-in-out infinite',
        'pulse-red': 'pulseRed 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,212,170,0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(0,212,170,0.3)' },
        },
        pulseRed: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,71,87,0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(255,71,87,0.3)' },
        },
        slideIn: {
          from: { transform: 'translateY(-8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

