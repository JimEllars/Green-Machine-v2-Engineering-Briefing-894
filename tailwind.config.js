/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // enterprise dark mode
  theme: {
    extend: {
      colors: {
        zinc: {
          850: '#202024',
          950: '#0f0f12',
        },
        emerald: {
          450: '#10b981', // custom interactive state accent
        }
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(to bottom right, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01))',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(56, 189, 248, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(56, 189, 248, 0.6), 0 0 10px rgba(56, 189, 248, 0.4)' }
        }
      }
    },
  },
  plugins: [],
}
