import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {devApiPlugin} from './scripts/devApiPlugin';

export default defineConfig(({mode}) => {
  // envDir は設定ファイルのある場所を基準にする。
  // '.' だとプロセスの作業ディレクトリ依存になり、リポジトリ外から
  // vite を起動したときに .env.local を見つけられない。
  const env = loadEnv(mode, __dirname, '');

  return {
    // GEMINI_API_KEY を define でクライアントに埋め込まない。
    // バンドルに焼き込むと誰でもバンドルから取り出せるため、
    // サーバー（api/*.ts）の process.env からのみ読む。
    plugins: [react(), tailwindcss(), devApiPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
