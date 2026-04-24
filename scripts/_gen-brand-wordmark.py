"""
Generate `mobile/assets/brand-wordmark.png` — the full Coin-C + "Cpay"
lockup baked into a single raster asset so the splash screen never has
to render Text on Android. This sidesteps every font-metric clipping
issue (the "Cpa" truncation) because rasterised pixels don't care
whether DM Sans has loaded yet.

Run inside WSL Ubuntu:
    python3 scripts/_gen-brand-wordmark.py

Output: mobile/assets/brand-wordmark.png (@3x · 960×240 px for crisp
render on dense phone displays).
"""
import pathlib
import cairosvg

# Mirrors `LOCKUP_SVG` in backend/apps/core/management/commands/render_brand_assets.py.
# DM Sans is the brand font; when cairosvg can't find it on the host it
# falls back gracefully — but we're baking pixels, so even the fallback
# stays stable across every install of the app.
LOCKUP_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <style>
    .cpay-text { font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
                  font-weight: 700; font-size: 46px; letter-spacing: -1px; }
  </style>
  <!-- Coin-C mark on the left -->
  <g transform="translate(8 8)">
    <circle cx="32" cy="32" r="23" fill="none" stroke="#10B981"
            stroke-width="7" stroke-linecap="round"
            stroke-dasharray="120 160"
            transform="rotate(-135 32 32)"/>
    <rect x="32" y="29.5" width="14.5" height="5" rx="1" fill="#10B981"/>
  </g>
  <!-- Wordmark on the right -->
  <text x="80" y="52" class="cpay-text" fill="#F1F5F9"><tspan fill="#10B981">C</tspan>pay</text>
</svg>"""

out = pathlib.Path(__file__).resolve().parent.parent / "mobile" / "assets" / "brand-wordmark.png"
out.parent.mkdir(parents=True, exist_ok=True)

cairosvg.svg2png(
    bytestring=LOCKUP_SVG.encode("utf-8"),
    write_to=str(out),
    output_width=960,   # 3× density → sharp on 420+ dpi Android
    output_height=240,
)
print(f"wrote {out}")
