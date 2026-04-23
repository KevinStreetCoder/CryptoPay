"""
Render the Cpay brand lockup (Coin-C mark + "Cpay" wordmark) to PNG files.

Email clients — most prominently Gmail — strip inline SVG from the body.
Hosting the brand assets as PNGs served over HTTPS lets every client render
the header reliably via ``<img src="…">``. The PDF receipt still uses inline
SVG because WeasyPrint renders it natively.

Outputs (idempotent, overwrites):

  <static root>/brand/logo-email-mark.png        (64×64, transparent bg)
  <static root>/brand/logo-email-wordmark.png    (240×64, transparent bg)
  <static root>/brand/logo-email-lockup.png      (320×80, transparent bg)

Usage::

    docker compose exec web python manage.py render_brand_assets

Production deploys copy ``<static root>/brand/`` into ``/var/www/cpay-static/``
behind nginx so the files are reachable at ``https://cpay.co.ke/brand/…``.
"""

import os

from django.conf import settings
from django.core.management.base import BaseCommand


# Coin-C mark as standalone SVG. Ported from cpay/project/logos.jsx
# (LogoCoinC) so the email PNG stays pixel-accurate with the design file.
COIN_C_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="{px}" height="{px}">
  <circle cx="100" cy="100" r="72" fill="none" stroke="#10B981"
          stroke-width="22" stroke-linecap="round"
          stroke-dasharray="380 500"
          transform="rotate(-135 100 100)"/>
  <rect x="100" y="92" width="46" height="16" rx="3" fill="#10B981"/>
</svg>"""

# Wordmark: "Cpay" where the "C" is emerald #10B981. DM Sans 700.
WORDMARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64" width="{w}" height="{h}">
  <style>
    .cpay-text {{ font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
                  font-weight: 700; font-size: 52px; letter-spacing: -1px; }}
  </style>
  <text x="0" y="48" class="cpay-text" fill="#F1F5F9"><tspan fill="#10B981">C</tspan>pay</text>
</svg>"""

# Full lockup: Coin-C mark + wordmark side-by-side on an ink background strip
# (matches the landing-page EmailHeader treatment).
LOCKUP_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="{w}" height="{h}">
  <style>
    .cpay-text {{ font-family: 'DM Sans', 'Segoe UI', system-ui, sans-serif;
                  font-weight: 700; font-size: 46px; letter-spacing: -1px; }}
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


class Command(BaseCommand):
    help = "Render Cpay brand lockup SVGs to PNG for email/receipt headers."

    def handle(self, *args, **opts):
        try:
            import cairosvg
        except ImportError:
            self.stderr.write(self.style.ERROR(
                "cairosvg not available. WeasyPrint's deps usually ship it. "
                "Install with: pip install cairosvg"
            ))
            return

        # Write to the SOURCE tree (`backend/static/brand/`), not to
        # STATIC_ROOT which is built by `collectstatic` and is read-only
        # in our container. This way the PNGs land in git, get baked
        # into the image at build time, and `collectstatic` ships them
        # to STATIC_ROOT on deploy alongside admin/ and rest_framework/.
        out_dir = os.path.join(settings.BASE_DIR, "static", "brand")
        os.makedirs(out_dir, exist_ok=True)

        outputs = [
            ("logo-email-mark.png",     COIN_C_SVG.format(px=64),              64, 64),
            ("logo-email-wordmark.png", WORDMARK_SVG.format(w=240, h=64),      240, 64),
            ("logo-email-lockup.png",   LOCKUP_SVG.format(w=320, h=80),        320, 80),
        ]

        for name, svg_str, w, h in outputs:
            out_path = os.path.join(out_dir, name)
            cairosvg.svg2png(
                bytestring=svg_str.encode("utf-8"),
                write_to=out_path,
                output_width=w * 2,   # 2× retina
                output_height=h * 2,
            )
            self.stdout.write(self.style.SUCCESS(
                f"wrote {out_path} ({w}×{h} @2x)"
            ))

        self.stdout.write(self.style.SUCCESS(
            f"\n3 brand PNGs rendered under {out_dir}. "
            f"Copy to /var/www/cpay-static/brand/ on the VPS and nginx will "
            f"serve them at https://cpay.co.ke/brand/<name>."
        ))
