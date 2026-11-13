import { expect, test } from './card.ts';

test.use({ config: { local_only: true, glass_refraction: false } });

test('rain keeps moving without sky uploads when refraction is off, and the flag can be reversed', async ({
  card,
  page,
}, info) => {
  const gpu = info.project.use.browserName !== 'webkit';
  const draw = (refraction: boolean, phase: number) =>
    page.evaluate(
      ({ refraction, phase }) => {
        const mounted = document.querySelector('iweather-card');
        if (!mounted) throw new Error('No weather card.');
        mounted.setConfig({ ...mounted.config, glass_refraction: refraction });
        mounted.paint(phase);
        const original: unknown = Reflect.get(WebGLRenderingContext.prototype, 'texImage2D');
        if (typeof original !== 'function') throw new Error('No WebGL texture upload.');
        let uploads = 0;
        WebGLRenderingContext.prototype.texImage2D = function (this: WebGLRenderingContext, ...args: unknown[]) {
          uploads++;
          Reflect.apply(original, this, args);
        };
        try {
          // A still glass draw samples a resident GPU sky or refreshes the native sky.
          mounted.glass.paint(0);
        } finally {
          Reflect.set(WebGLRenderingContext.prototype, 'texImage2D', original);
        }
        mounted.glass.paint(phase);
        const canvas = mounted.glass.drops,
          ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) throw new Error('No rain-on-glass surface.');
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let fingerprint = 0,
          visible = 0;
        for (let i = 0; i < pixels.length; i++) {
          fingerprint = Math.imul(fingerprint, 31) ^ (pixels[i] ?? 0);
          if (i % 4 === 3 && (pixels[i] ?? 0) > 0) visible++;
        }
        return { uploads, fingerprint, visible, gpu: mounted.scene.hasGPUSky };
      },
      { refraction, phase },
    );
  await expect(card.locator('canvas.drops').first()).toBeAttached();
  const plain = await draw(false, 8000);
  expect(plain.uploads).toBe(0);
  expect(plain.gpu).toBe(gpu);
  expect(plain.visible).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('refraction-off.png') });
  const moved = await draw(false, 9000);
  expect(moved.uploads).toBe(0);
  expect(moved.fingerprint).not.toBe(plain.fingerprint);
  const refracted = await draw(true, 8000);
  expect(refracted.uploads).toBe(gpu ? 0 : 2);
  expect(refracted.gpu).toBe(gpu);
  expect(refracted.visible).toBeGreaterThan(0);
  expect(refracted.fingerprint).not.toBe(plain.fingerprint);
  await page.screenshot({ path: info.outputPath('refraction-on.png') });
  const restored = await draw(false, 8000);
  expect(restored).toEqual(plain);
});
