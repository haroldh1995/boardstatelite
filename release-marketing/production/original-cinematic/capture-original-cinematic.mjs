import { chromium } from 'playwright';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const htmlPath = path.join(root, 'release-marketing', 'production', 'original-cinematic', 'boardstate-lite-original-cinematic.html');
const rawDir = path.join(root, 'release-marketing', 'raw', 'original-cinematic');
const screenshotDir = path.join(root, 'release-marketing', 'evidence', 'original-cinematic', 'frames');
await mkdir(rawDir, { recursive: true });
await mkdir(screenshotDir, { recursive: true });

const jobs = [
  { format: 'landscape', name: 'original-cinematic-master-16x9', width: 1920, height: 1080, seconds: 76 },
  { format: 'vertical', name: 'original-cinematic-social-9x16', width: 1080, height: 1920, seconds: 76 },
  { format: 'teaser', name: 'original-cinematic-teaser-15s', width: 1080, height: 1920, seconds: 16 },
];
const requested = process.argv[2];
const selectedJobs = requested ? jobs.filter((job) => job.format === requested) : jobs;
if (requested && selectedJobs.length === 0) throw new Error(`Unknown capture format: ${requested}`);

const browser = await chromium.launch({ headless: true });
try {
  for (const job of selectedJobs) {
    const context = await browser.newContext({
      viewport: { width: job.width, height: job.height },
      recordVideo: { dir: rawDir, size: { width: job.width, height: job.height } },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const video = page.video();
    await page.goto(`${pathToFileURL(htmlPath).href}?format=${job.format}`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(screenshotDir, `${job.name}-opening.png`) });
    await page.waitForTimeout(job.seconds * 1000);
    await page.screenshot({ path: path.join(screenshotDir, `${job.name}-closing.png`) });
    await context.close();
    const source = await video.path();
    await copyFile(source, path.join(rawDir, `${job.name}.webm`));
    await rm(source, { force: true });
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ root, rawDir, screenshotDir, jobs: selectedJobs }, null, 2));
