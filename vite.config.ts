import { defineConfig } from 'vitest/config';

// GitHub Pages (プロジェクトサイト) は https://<user>.github.io/hakaroom/ で配信されるため、
// 絶対パスの参照が正しく解決されるよう base を指定する。
export default defineConfig({
  base: '/hakaroom/',
  test: {
    environment: 'jsdom',
  },
});
