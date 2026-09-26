import { defineConfig, devices } from '@playwright/test';

// Headless CI machines have no GPU, so WebGL runs in SwiftShader (software). Tests open the app
// with ?e2e, which lets the simulation take bigger time steps so animations finish on slow frames.
const chromiumPath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  // software WebGL is CPU-heavy, so run one browser at a time
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 960, height: 600 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 960, height: 600 },
      launchOptions: {
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        ...(chromiumPath ? { executablePath: chromiumPath } : {})
      }
    }
  }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
