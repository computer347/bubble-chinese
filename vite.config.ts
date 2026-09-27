/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the build works on GitHub Pages under /<repo>/ and anywhere else
  base: './',
  // three.js is most of the bundle (~180 kB gzipped); code-splitting per game mode comes with Phase 1
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    // three.js and the word/sentence data in their own files, so browsers cache them separately
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'content', test: /src[\\/]content[\\/]generated/ }
          ]
        }
      }
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
});
