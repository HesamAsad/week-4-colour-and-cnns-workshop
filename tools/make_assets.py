"""Build js/imgdata.js for the Workshop 4 deck: base64 images + CIE colour data.

Run from this directory:  python3 make_assets.py

The three chessboard images are the ones the worksheet links to. Fetch them first:
    for n in 1 2 3; do
      curl -sSLO https://raw.githubusercontent.com/saraao/COMP90086_image/main/img$n.png
    done
"""
import base64
import io
import json
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'js', 'imgdata.js')
SCRATCH = HERE + '/'                       # where img1/img2/img3.png were downloaded
WEEK4 = os.path.join(HERE, '..', '..', 'week4') + '/'


def datauri(path, width, quality=86, crop=None):
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(crop)
    h = int(round(width * im.size[1] / im.size[0]))
    im = im.resize((width, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True)
    b = base64.b64encode(buf.getvalue()).decode()
    print(f'  {path.split("/")[-1]:16s} {width}x{h}  {len(b)/1024:6.1f} kB')
    return 'data:image/jpeg;base64,' + b


# ---------------------------------------------------------------- images
print('images:')
images = {
    'macaws':   datauri(WEEK4 + 'kodim23.png', 560),           # Kodak "kodim23"
    'chess1':   datauri(SCRATCH + 'img1.png', 720),            # illumination changes
    'chess2':   datauri(SCRATCH + 'img2.png', 720),            # reflectance changes
    'chess3':   datauri(SCRATCH + 'img3.png', 720),            # reflectance + normal
}

# ------------------------------------------- CIE 1931 2-deg colour matching
# Multi-lobe Gaussian fit, Wyman, Sloan & Shirley (JCGT 2013), "Simple Analytic
# Approximations to the CIE XYZ Color Matching Functions".  Within ~1% of the
# tabulated standard observer, and small enough to embed.
def g(x, mu, s1, s2):
    s = np.where(x < mu, s1, s2)
    return np.exp(-0.5 * ((x - mu) / s) ** 2)


lam = np.arange(390, 736, 5.0)
xb = 1.056 * g(lam, 599.8, 37.9, 31.0) + 0.362 * g(lam, 442.0, 16.0, 26.7) \
     - 0.065 * g(lam, 501.1, 20.4, 26.2)
yb = 0.821 * g(lam, 568.8, 46.9, 40.5) + 0.286 * g(lam, 530.9, 16.3, 31.1)
zb = 1.217 * g(lam, 437.0, 11.8, 36.0) + 0.681 * g(lam, 459.0, 26.0, 13.8)

print('\nCMF sanity checks:')
print(f'  peak of y-bar at {lam[yb.argmax()]:.0f} nm   (standard: 555 nm)')
print(f'  peak of x-bar at {lam[xb.argmax()]:.0f} nm   (standard: 600 nm)')
print(f'  peak of z-bar at {lam[zb.argmax()]:.0f} nm   (standard: 445 nm)')
print(f'  max y-bar = {yb.max():.3f}                  (standard: 1.000)')
E = np.array([xb.sum(), yb.sum(), zb.sum()])
# The CIE normalised the three functions so that an equal-energy illuminant gives
# X = Y = Z exactly, so all three ratios should come out at 1.000.
print(f'  equal-energy white XYZ ratios = {np.round(E / E[1], 3)}  (standard: [1 1 1])')

cie = {
    'lambda': lam.astype(int).tolist(),
    'x': np.round(xb, 4).tolist(),
    'y': np.round(yb, 4).tolist(),
    'z': np.round(zb, 4).tolist(),
}

# ---------------------------------------------------------------- write
with open(OUT, 'w') as f:
    f.write('// Workshop 4 assets — base64 images and CIE 1931 colour data, so every\n'
            '// demo runs offline from file://  (generated, do not hand-edit).\n')
    f.write('window.IMAGES = ' + json.dumps(images, indent=0).replace('\n', '\n') + ';\n\n')
    f.write('// CIE 1931 2-degree standard observer colour matching functions.\n'
            '// Multi-lobe Gaussian fit: Wyman, Sloan & Shirley, JCGT 2013.\n')
    f.write('window.CIE = ' + json.dumps(cie, separators=(',', ':')) + ';\n')

print(f'\nwrote {OUT}  ({os.path.getsize(OUT)/1024:.0f} kB)')
