/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07070A',
          900: '#0C0C11',
          850: '#111118',
          800: '#16161F',
          700: '#1E1E29',
          600: '#2A2A38',
          500: '#3A3A4C',
        },
        gold: {
          50: '#FBF6EA',
          100: '#F3E7C6',
          200: '#E8D39A',
          300: '#DCC07A',
          400: '#C9A961',
          500: '#B08F48',
          600: '#8C7036',
        },
        mist: { 100: '#EDEDF2', 300: '#B9B9C6', 400: '#8D8D9E', 500: '#6B6B7D' },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['"Manrope Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        lux: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -20px rgba(0,0,0,0.8)',
        glow: '0 0 0 1px rgba(201,169,97,0.35), 0 8px 30px -8px rgba(201,169,97,0.35)',
      },
      backgroundImage: {
        'gold-sheen': 'linear-gradient(135deg, #F3E7C6 0%, #C9A961 45%, #8C7036 100%)',
        'ink-radial': 'radial-gradient(1200px 600px at 10% -10%, rgba(201,169,97,0.10), transparent 60%), radial-gradient(900px 500px at 110% 110%, rgba(120,110,200,0.08), transparent 60%)',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(201,169,97,0.55)' }, '100%': { boxShadow: '0 0 0 10px rgba(201,169,97,0)' } },
      },
      animation: { 'fade-up': 'fade-up .28s ease-out both', 'pulse-ring': 'pulseRing 1.2s ease-out infinite' },
    },
  },
  plugins: [],
};
