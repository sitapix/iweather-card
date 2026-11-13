# Bakes assets/moon-relief.avif from NASA's CGI Moon Kit (public domain):
# https://svs.gsfc.nasa.gov/4720 — lroc_color_poles_4k.tif (colour) and ldem_16.tif
# (elevation, km, 16 pixels per degree). The near side (longitude -90..90, latitude 90..-90)
# as three channels for the GPU moon, which lights the surface itself:
#   red    the colour map's brightness, with no shading, toned to the same 5th–95th
#          percentiles (.29–.675) as moon-near-side.avif so the renderer's mapping applies;
#   green  the surface normal's eastward part, and
#   blue   its northward part, both from -1..1 onto 0..255 (128 is level ground), from the
#          elevation with the relief exaggerated so craters read at the moon's size on screen.
# 768px, AVIF 4:4:4 at quality 45 (the channels are separate data, so none is subsampled; about
# 120 KB, where 35 blurred the crater rims and 60 doubled the size for little more).
#
#   uv run --with pillow --with numpy python -I scripts/moon-relief.py <color.tif> <ldem.tif> assets/moon-relief.avif
# (needs avifenc, from libavif)
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SIZE, RELIEF, QUALITY = 768, 3.0, 45
color_path, elevation_path, out_path = sys.argv[1:4]


def near_side(image):
    # Equirectangular, longitude -180..180 left to right: the middle half is the near side.
    width, height = image.size
    return image.crop((width // 4, 0, width * 3 // 4, height))


albedo = np.asarray(near_side(Image.open(color_path).convert('L')).resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float64) / 255
elevation = np.asarray(near_side(Image.open(elevation_path)).resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float64)

# Slopes in km per km: a pixel spans 180° / SIZE of arc, narrower east–west toward the poles.
# Rows run north to south, so the northward slope is minus the slope down the rows. Near the
# poles the pixels' east–west span shrinks toward nothing and would blow the map's noise up
# into speckle, so it is taken no narrower than a quarter of the equator's.
radius = 1737.4
step = radius * np.pi / SIZE
latitude = np.linspace(np.pi / 2, -np.pi / 2, SIZE)[:, None]
dz_drow, dz_dcol = np.gradient(elevation * RELIEF)
east = dz_dcol / (step * np.maximum(np.cos(latitude), 0.25))
north = -dz_drow / step
length = np.sqrt(east**2 + north**2 + 1)
normal_east, normal_north = -east / length, -north / length

low, high = np.percentile(albedo[SIZE // 4 : SIZE * 3 // 4, SIZE // 4 : SIZE * 3 // 4], [5, 95])
toned = 0.29 + (albedo - low) * (0.675 - 0.29) / (high - low)
channels = np.stack([np.clip(toned, 0, 1), normal_east * 0.5 + 0.5, normal_north * 0.5 + 0.5], axis=-1)
with tempfile.TemporaryDirectory() as scratch:
    lossless = os.path.join(scratch, 'moon.png')
    Image.fromarray((np.clip(channels, 0, 1) * 255).round().astype(np.uint8), 'RGB').save(lossless)
    subprocess.run(
        ['avifenc', '-q', str(QUALITY), '-s', '0', '-d', '8', '-y', '444', '--cicp', '1/13/0', lossless, out_path],
        check=True,
        stdout=subprocess.DEVNULL,
    )
print(out_path, SIZE, 'px')
