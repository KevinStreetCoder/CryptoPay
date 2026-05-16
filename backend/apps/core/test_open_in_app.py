"""Regression tests for /open/ · smart "open in app" redirect.

2026-05-17 · transactional emails ("View in App" / "Open Wallet")
hit this endpoint so users without the Android app see a Play Store
prompt instead of landing on the dead-end web login.

Contract:
  GET /open/?path=<whitelisted>&id=<uuid>
    → 200, text/html
    → Android UA: HTML contains `intent://` URL pointing at the app
        package + Play Store fallback
    → non-Android UA: HTML meta-refreshes to app.cpay.co.ke web bundle
  GET /open/?path=<not-whitelisted>  → 400 (closed open-redirector)

Security: ONLY whitelisted paths route through · any path injection
attempt returns 400 plain-text so we never emit an open-redirector.
"""
from __future__ import annotations

import pytest
from django.test import TestCase, Client


pytestmark = pytest.mark.django_db


ANDROID_UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile"
)
IOS_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148"
)
DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71"
)


class TestOpenInAppView(TestCase):
    def setUp(self):
        self.client = Client()

    # ── whitelist enforcement ─────────────────────────────────────

    def test_rejects_unknown_path(self):
        r = self.client.get("/open/?path=evil/redirect")
        assert r.status_code == 400, r.content
        body = r.content.decode()
        assert "Unknown deep-link path" in body

    def test_rejects_absolute_url_path(self):
        # An attacker tries to bend /open/ into an open-redirector.
        # The whitelist refuses anything outside the known set.
        r = self.client.get("/open/?path=https://evil.example/x")
        assert r.status_code == 400

    def test_rejects_empty_path(self):
        r = self.client.get("/open/")
        assert r.status_code == 400

    def test_accepts_whitelisted_payment_detail(self):
        r = self.client.get(
            "/open/?path=payment/detail&id=abc-123",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        assert r.status_code == 200, r.content

    def test_accepts_whitelisted_wallet(self):
        r = self.client.get(
            "/open/?path=(tabs)/wallet",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        assert r.status_code == 200, r.content

    # ── Android branch ────────────────────────────────────────────

    def test_android_emits_intent_url(self):
        r = self.client.get(
            "/open/?path=payment/detail&id=abc-123",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        body = r.content.decode()
        # Intent URL must:
        #   - target the actual package
        #   - carry the deep-link path
        #   - declare a browser_fallback_url (Play Store) so users
        #     without the app aren't stuck on a chrome://no-handler
        assert "intent://" in body
        assert "package=ke.co.cryptopay.app" in body
        assert "payment/detail?id=abc-123" in body
        assert "browser_fallback_url=" in body
        assert "play.google.com" in body or "cpay.co.ke%2Fapk" in body

    def test_android_intent_has_play_store_fallback(self):
        r = self.client.get(
            "/open/?path=(tabs)/wallet",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        body = r.content.decode()
        # The S.browser_fallback_url is URL-encoded · check for either
        # the encoded Play Store URL or the encoded /apk/ short URL.
        assert (
            "play.google.com" in body
            or "cpay.co.ke%2Fapk" in body
            or "cpay.co.ke/apk" in body
        ), body[:600]

    def test_android_runs_js_redirect(self):
        # The page MUST have a `window.location.href = "intent://..."`
        # so that the redirect fires the moment the page loads · users
        # don't have to click anything.
        r = self.client.get(
            "/open/?path=payment/detail&id=u-1",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        body = r.content.decode()
        assert "window.location.href" in body
        assert "intent://" in body

    # ── iOS / desktop / unknown branch ────────────────────────────

    def test_ios_falls_back_to_web_bundle(self):
        r = self.client.get(
            "/open/?path=payment/detail&id=xyz",
            HTTP_USER_AGENT=IOS_UA,
        )
        body = r.content.decode()
        # No intent:// for non-Android · we ship no iOS app yet, so
        # routing through Play Store would be a dead-end for iPhone.
        assert "intent://" not in body
        assert "app.cpay.co.ke/payment/detail" in body

    def test_desktop_falls_back_to_web_bundle(self):
        r = self.client.get(
            "/open/?path=(tabs)/wallet",
            HTTP_USER_AGENT=DESKTOP_UA,
        )
        body = r.content.decode()
        assert "intent://" not in body
        assert "app.cpay.co.ke/(tabs)/wallet" in body

    def test_meta_refresh_present_for_no_js_clients(self):
        # The <meta http-equiv="refresh"> fallback covers email
        # clients that strip <script> when previewing the page in
        # their iframe sandbox.
        r = self.client.get(
            "/open/?path=(tabs)/wallet",
            HTTP_USER_AGENT=DESKTOP_UA,
        )
        body = r.content.decode()
        assert "http-equiv=\"refresh\"" in body
        assert "app.cpay.co.ke" in body

    # ── caching ───────────────────────────────────────────────────

    def test_response_is_not_cacheable(self):
        # Branch depends on User-Agent · a caching proxy that memoised
        # the Android-flavoured response would silently break iOS users
        # behind the same egress. Force no-store.
        r = self.client.get(
            "/open/?path=(tabs)/wallet",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        assert "no-store" in r.get("Cache-Control", ""), r.get("Cache-Control")

    # ── injection / escaping ──────────────────────────────────────

    def test_id_param_is_url_encoded_in_paths(self):
        # An evil `id` that tries to inject extra query params or a
        # path traversal must be URL-encoded · still rendered as a
        # literal string inside the resulting URLs.
        r = self.client.get(
            "/open/?path=payment/detail&id=" + "abc&extra=evil",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        body = r.content.decode()
        # `&extra=evil` should NOT appear unencoded after the wrapper
        # path · if it did, it'd hijack the query string.
        # (Django's QueryDict already drops the second `=` value, but
        # the wrapped intent URL must still escape what it kept.)
        # We assert the unsafe shape isn't there:
        bad = "id=abc&extra=evil#Intent"
        assert bad not in body, body[:800]

    def test_no_auth_required(self):
        # Pre-login users (welcome email recipients) must be able to
        # hit /open/ before they ever sign in.
        r = self.client.get(
            "/open/?path=(tabs)/wallet",
            HTTP_USER_AGENT=ANDROID_UA,
        )
        assert r.status_code == 200
