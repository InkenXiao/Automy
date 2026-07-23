import { defineConfig } from 'vite';
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

// 递归复制目录
function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

// 复制动态加载的静态资源到 dist
function staticCopyPlugin() {
  return {
    name: 'static-copy',
    closeBundle() {
      const dirs = ['docs', 'prototype', 'assets/data', 'images'];
      for (const dir of dirs) {
        copyDir(dir, join('dist', dir));
      }
      // 复制 img 目录(如果存在)
      copyDir('assets/img', join('dist', 'assets', 'img'));
    }
  };
}

// Vite 配置 - 静态打包用于 Cloudflare Pages 部署
// base 设为相对路径以支持子路径访问
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // 静态多页站点,无需自动注入入口
    rollupOptions: {
      input: {
        main: 'index.html',
        notFound: '404.html',
        components: 'shared/components.html'
      }
    }
  },
  plugins: [staticCopyPlugin()],
  server: {
    port: 5173,
    open: true,
    // 支持通过 hash 路由访问子页面
    appType: 'mpa'
  }
});
