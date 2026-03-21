/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:    '#08080d',
          primary: '#0e0e16',
          secondary: '#111118',
          tertiary: '#16161f',
          card:    '#1a1a26',
          hover:   '#1e1e2e',
          active:  '#20203a',
        },
        border: {
          DEFAULT: '#1a1a28',
          light:   '#242438',
          focus:   '#00d9ff44',
        },
        cyan:   { DEFAULT: '#00d9ff', dim: '#00d9ff44', glow: '#00d9ff22' },
        accent: {
          cyan:   '#00d9ff',
          purple: '#7c3aed',
          green:  '#00e676',
          red:    '#ff1744',
          orange: '#ff6b35',
          yellow: '#fbbf24',
        },
        text: {
          primary:   '#e2e8f0',
          secondary: '#94a3b8',
          muted:     '#475569',
          dim:       '#2d3748',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'slide-in':   'slideIn 0.15s ease-out',
        'fade-in':    'fadeIn 0.1s ease-out',
        'pulse-cyan': 'pulseCyan 2s ease-in-out infinite',
        'blink':      'blink 1s step-end infinite',
      },
      keyframes: {
        slideIn:    { from: { transform: 'translateY(-6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:     { from: { opacity: '0' }, to: { opacity: '1' } },
        pulseCyan:  { '0%,100%': { boxShadow: '0 0 0 0 rgba(0,217,255,0)' }, '50%': { boxShadow: '0 0 0 3px rgba(0,217,255,0.25)' } },
        blink:      { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
    },
  },
  plugins: [],
}
