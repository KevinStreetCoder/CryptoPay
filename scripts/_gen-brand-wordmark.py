"""
Generate the Coin-C + "Cpay" lockup PNGs used by the splash screen.

Two variants written so the splash works on both themes (the previous
single-PNG used white "pay" which disappeared on the light theme bg):
    mobile/assets/brand-wordmark.png       · dark theme (white "pay")
    mobile/assets/brand-wordmark-light.png · light theme (ink "pay")

Run inside WSL Ubuntu:
    python3 scripts/_gen-brand-wordmark.py

@3x density (960×240) for crisp render on dense phone displays.
"""
import pathlib
import cairosvg

# Mirrors `LOCKUP_SVG` in backend/apps/core/management/commands/render_brand_assets.py.
# DM Sans is the brand font; when cairosvg can't find it on the host it
# falls back gracefully — but we're baking pixels, so even the fallback
# stays stable across every install of the app.
def _svg(pay_fill: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <style>
    .cpay-text {{ font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
                  font-weight: 700; font-size: 46px; letter-spacing: -1px; }}
  </style>
  <g transform="translate(8 8)">
    <circle cx="32" cy="32" r="23" fill="none" stroke="#10B981"
            stroke-width="7" stroke-linecap="round"
            stroke-dasharray="120 160"
            transform="rotate(-135 32 32)"/>
    <rect x="32" y="29.5" width="14.5" height="5" rx="1" fill="#10B981"/>
  </g>
  <text x="80" y="52" class="cpay-text" fill="{pay_fill}"><tspan fill="#10B981">C</tspan>pay</text>
</svg>"""


_OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "mobile" / "assets"
_OUT_DIR.mkdir(parents=True, exist_ok=True)

# Dark theme · "pay" in off-white ink-on-paper-style
cairosvg.svg2png(
    bytestring=_svg("#F1F5F9").encode("utf-8"),
    write_to=str(_OUT_DIR / "brand-wordmark.png"),
    output_width=960,
    output_height=240,
)
# Light theme · "pay" in brand ink so it renders on light page bg
cairosvg.svg2png(
    bytestring=_svg("#0B1220").encode("utf-8"),
    write_to=str(_OUT_DIR / "brand-wordmark-light.png"),
    output_width=960,
    output_height=240,
)
print(f"wrote {_OUT_DIR / 'brand-wordmark.png'}")
print(f"wrote {_OUT_DIR / 'brand-wordmark-light.png'}")
