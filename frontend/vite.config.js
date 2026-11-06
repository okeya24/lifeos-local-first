import {defineConfig} from 'vite';

// base 用相对路径，构建产物可以直接部署在任意子路径。
export default defineConfig({
  base: './',
  server: {
    // 把 /api 代理到本机 LifeOS 服务，避免跨域
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  }
});
