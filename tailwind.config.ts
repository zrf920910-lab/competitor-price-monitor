import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b0b8c8',
          400: '#8492a8',
          500: '#64748b',
          600: '#4e5b70',
          700: '#3f4a5c',
          800: '#363f4e',
          900: '#1f2530',
        },
        brand: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bed3ff',
          300: '#91b5ff',
          400: '#5d8cff',
          500: '#3765f5',
          600: '#2347e2',
          700: '#1c37b6',
          800: '#1d3290',
          900: '#1d2f72',
        },
        // 中国股市惯例：涨红跌绿
        up: '#e5484d',
        down: '#2f9e44',
        // 中间档警示（价差偏大但未到刺眼程度）
        warn: '#f5a524',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(31, 37, 48, 0.08)',
        card: '0 1px 2px rgba(31, 37, 48, 0.04), 0 8px 24px rgba(31, 37, 48, 0.06)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.28s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
