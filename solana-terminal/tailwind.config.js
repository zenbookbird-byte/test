/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ax: {
          base:    '#080a0e',
          nav:     '#0c0e14',
          sidebar: '#0e1018',
          panel:   '#111420',
          card:    '#151825',
          hover:   '#191d2c',
          active:  '#1d2232',
          border:  '#1e2235',
          bordl:   '#252b3e',
        },
        green: {
          DEFAULT: '#16c784',
          dim:     '#16c78422',
          glow:    '#16c78433',
          dark:    '#0e9b66',
          light:   '#1edf95',
        },
        red: {
          DEFAULT: '#ea3943',
          dim:     '#ea394322',
        },
        text: {
          primary:   '#e1e8f5',
          secondary: '#8892a4',
          muted:     '#4a5168',
          dim:       '#2e3447',
        },
        blue: {
          accent: '#3772ff',
          dim:    '#3772ff22',
        },
        yellow: { DEFAULT: '#f5b24b' },
        purple: { DEFAULT: '#9b5de5' },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['10px', '14px'],
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
      },
      animation: {
        'slide-in': 'slideIn 0.15s ease-out',
        'fade-in':  'fadeIn 0.1s ease-out',
        'pulse-g':  'pulseG 2s ease-in-out infinite',
        'blink':    'blink 1s step-end infinite',
        'row-flash-green': 'rowFlashGreen 0.8s ease-out',
        'row-flash-red':   'rowFlashRed 0.8s ease-out',
      },
      keyframes: {
        slideIn:       { from: { transform: 'translateY(-6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:        { from: { opacity: '0' }, to: { opacity: '1' } },
        pulseG:        { '0%,100%': { boxShadow: '0 0 0 0 #16c78400' }, '50%': { boxShadow: '0 0 0 3px #16c78440' } },
        blink:         { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        rowFlashGreen: { '0%': { background: '#16c78418' }, '100%': { background: 'transparent' } },
        rowFlashRed:   { '0%': { background: '#ea394318' }, '100%': { background: 'transparent' } },
      },
      boxShadow: {
        'green-glow': '0 0 20px #16c78430',
        'panel': '0 4px 24px rgba(0,0,0,0.4)',
        'dropdown': '0 8px 32px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}
