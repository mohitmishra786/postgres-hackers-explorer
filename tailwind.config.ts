import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'retro-bg': '#0a0a0a',
        'retro-surface': '#111111',
        'retro-border': '#1a2e1a',
        'retro-primary': '#00ff41',
        'retro-secondary': '#00cc33',
        'retro-muted': '#004d14',
        'retro-text': '#ccffcc',
        'retro-accent': '#ffffff',
        'retro-error': '#ff4444',
        'retro-warning': '#ffaa00',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      animation: {
        'blink': 'blink 1s step-end infinite',
        'typewriter': 'typewriter 2s steps(40, end)',
        'scanline': 'scanline 8s linear infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'flicker': 'flicker 0.15s infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        typewriter: {
          from: { width: '0' },
          to: { width: '100%' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 5px #00ff41, 0 0 10px #00ff41' },
          '50%': { boxShadow: '0 0 10px #00ff41, 0 0 20px #00ff41, 0 0 30px #00ff41' },
        },
        flicker: {
          '0%': { opacity: '0.97' },
          '5%': { opacity: '0.95' },
          '10%': { opacity: '0.9' },
          '15%': { opacity: '0.95' },
          '20%': { opacity: '0.97' },
          '25%': { opacity: '0.93' },
          '30%': { opacity: '0.97' },
          '35%': { opacity: '0.95' },
          '40%': { opacity: '0.98' },
          '45%': { opacity: '0.95' },
          '50%': { opacity: '0.97' },
          '55%': { opacity: '0.94' },
          '60%': { opacity: '0.97' },
          '65%': { opacity: '0.95' },
          '70%': { opacity: '0.98' },
          '75%': { opacity: '0.96' },
          '80%': { opacity: '0.97' },
          '85%': { opacity: '0.95' },
          '90%': { opacity: '0.97' },
          '95%': { opacity: '0.96' },
          '100%': { opacity: '0.97' },
        },
      },
      boxShadow: {
        'retro': '0 0 5px #00ff41, 0 0 10px #00ff41',
        'retro-lg': '0 0 10px #00ff41, 0 0 20px #00ff41, 0 0 30px #00ff41',
        'retro-inner': 'inset 0 0 5px #00ff41',
      },
    },
  },
  plugins: [],
}

export default config
