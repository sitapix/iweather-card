# Bakes assets/moon-near-side.avif from NASA's CGI Moon Kit (public domain):
# https://svs.gsfc.nasa.gov/4720 — lroc_color_poles_4k.tif (colour) and ldem_16.tif
# (elevation, km, 16 pixels per degree). The colour map has no shadows, so craters look
# flat; a hill-shade of the elevation, lit from the upper left with the relief
# exaggerated, puts light and shadow back on their rims, as a photograph has.
# Output: the near side (longitude -90..90, latitude 90..-90) as a 768px greyscale
# AVIF (sharper than the sheet's moon is drawn on a high-density screen; at quality 55, about
# 70 KB and closer to the bake than JPEG at quality 70 was at 100 KB), toned
# to the old texture's 5th–95th percentiles (.29–.675) so the renderer's mapping still
# applies.
#
#   uv run --with pillow --with numpy python -I scripts/moon-texture.py <color.tif> <ldem.tif> assets/moon-near-side.avif
# (needs avifenc, from libavif)
import os
import subprocess
import sys
import tempfile
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SIZE, RELIEF, STRENGTH = 768, 3.0, .7
color_path, elevation_path, out_path = sys.argv[1:4]

def near_side(image):
    # Equirectangular, longitude -180..180 left to right: the middle half is the near side.
    width, height = image.size
    return image.crop((width // 4, 0, width * 3 // 4, height))

albedo = np.asarray(near_side(Image.open(color_path).convert('L')).resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float64) / 255
elevation = np.asarray(near_side(Image.open(elevation_path)).resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float64)

# Slopes in km per km: a pixel spans 180° / SIZE of arc, narrower east–west toward the poles.
radius = 1737.4
step = radius * np.pi / SIZE
latitude = np.linspace(np.pi / 2, -np.pi / 2, SIZE)[:, None]
dz_dy, dz_dx = np.gradient(elevation * RELIEF)
dz_dx = dz_dx / (step * np.maximum(np.cos(latitude), .05))
dz_dy = dz_dy / step
# Lambert shading from the upper left, 45° up, normalised so level ground is 1.
light = np.array([-.5, .5, np.sqrt(.5)])
light /= np.linalg.norm(light)
normal_length = np.sqrt(dz_dx ** 2 + dz_dy ** 2 + 1)
shade = (-dz_dx * light[0] + dz_dy * light[1] + light[2]) / normal_length / light[2]
baked = albedo * (1 + STRENGTH * (np.clip(shade, 0, 2) - 1))

# Tone to the old texture's percentiles, so the renderer's mapping is unchanged.
low, high = np.percentile(baked[SIZE // 4:SIZE * 3 // 4, SIZE // 4:SIZE * 3 // 4], [5, 95])
toned = .29 + (baked - low) * (.675 - .29) / (high - low)
with tempfile.TemporaryDirectory() as scratch:
    lossless = os.path.join(scratch, 'moon.png')
    Image.fromarray((np.clip(toned, 0, 1) * 255).round().astype(np.uint8), 'L').save(lossless)
    subprocess.run(['avifenc', '-q', '55', '-s', '0', '-d', '8', '-y', '420', lossless, out_path], check=True, stdout=subprocess.DEVNULL)
print(out_path, SIZE, 'px')
