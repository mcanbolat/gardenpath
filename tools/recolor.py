"""Recolor a gray t-shirt photo into red/blue/green with equal CIELAB lightness and chroma."""
import sys, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from skimage import color

SRC, OUT = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float64) / 255.0
lab = color.rgb2lab(im)
L = lab[..., 0]

# --- mask: background is near-white & neutral; shirt is gray (L well below background)
bg_candidate = L > 86.5   # background AND the pale drop shadow (L ~85-97) stay original
lbl, _ = ndimage.label(bg_candidate)
edge_labels = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
background = np.isin(lbl, list(edge_labels))
# the drop shadow right under the hem is darker but smooth; heather fabric is grainy
mu = ndimage.uniform_filter(L, 7); sd = np.sqrt(np.maximum(ndimage.uniform_filter(L * L, 7) - mu * mu, 0))
textured = ndimage.binary_fill_holes(ndimage.binary_closing(sd > 2.6, iterations=8))
textured = ndimage.binary_opening(textured, iterations=6)          # drop thin smooth shadow strips
near_fabric = ndimage.binary_dilation(textured, iterations=3)
shirt = ~background & near_fabric
shirt = ndimage.binary_opening(shirt, iterations=2)
lbl2, n2 = ndimage.label(shirt)
sizes = ndimage.sum(shirt, lbl2, range(1, n2 + 1))
shirt = lbl2 == (np.argmax(sizes) + 1)
shirt = ndimage.binary_fill_holes(shirt)
shirt = ndimage.gaussian_filter(shirt.astype(float), 5) > 0.5     # smooth small notches in the outline
alpha = Image.fromarray((shirt * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
alpha = np.asarray(alpha).astype(np.float64) / 255.0

# --- shading / texture from the gray luminance (relative to the shirt's own mean)
core = ndimage.binary_erosion(shirt, iterations=6)
Lm, Ls = L[core].mean(), L[core].std()
print(f"source shirt L mean={Lm:.1f} sd={Ls:.2f}")

TARGET_L, TARGET_C, GAIN = 53.0, 52.0, 1.0
HUES = {"red": 30.0, "green": 142.0, "blue": 287.0}   # CIELAB hue angles (degrees)

# lift the off-white backdrop to pure white (#FFF) while keeping the soft drop shadow
wlift = np.clip((L - 89.0) / 7.0, 0, 1)[..., None]
bg_img = im * (1 - wlift) + 1.0 * wlift

meta = {}
for name, h in HUES.items():
    Lnew = TARGET_L + (L - Lm) * GAIN
    a = TARGET_C * np.cos(np.radians(h)) * np.ones_like(L)
    b = TARGET_C * np.sin(np.radians(h)) * np.ones_like(L)
    # slightly reduce chroma in deep shadows / highlights, like real dyed fabric
    scale = np.clip(1 - np.abs(Lnew - TARGET_L) / 50, 0.6, 1.0)
    rgb = color.lab2rgb(np.stack([Lnew, a * scale, b * scale], -1))
    clipped = ((rgb <= 0.0) | (rgb >= 1.0)).any(-1)[core].mean()
    out = np.clip(rgb, 0, 1) * alpha[..., None] + bg_img * (1 - alpha[..., None])   # white background + natural gray shadow
    img = Image.fromarray((out * 255).round().astype(np.uint8))
    # crop to a centered square around the shirt with even margin, then downsize
    ys, xs = np.where(shirt)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    half = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 * 1.06
    box = tuple(int(round(v)) for v in (cx - half, cy - half, cx + half, cy + half))
    img = img.crop(box).resize((800, 800), Image.LANCZOS)
    img.save(f"{OUT}/shirt_{name}.jpg", quality=90, optimize=True)
    # measured mean color on the final shirt pixels
    meas = color.rgb2lab(np.clip(rgb, 0, 1)[core])
    mL, ma, mb = meas.mean(0)
    hexv = "#%02X%02X%02X" % tuple((np.clip(color.lab2rgb([[[mL, ma, mb]]])[0, 0], 0, 1) * 255).round().astype(int))
    meta[name] = dict(hue=h, L=round(mL, 1), C=round(float(np.hypot(ma, mb)), 1), hex=hexv, clipped_frac=round(float(clipped), 4))
print(json.dumps(meta, indent=1))
json.dump(meta, open(f"{OUT}/colors.json", "w"), indent=1)
