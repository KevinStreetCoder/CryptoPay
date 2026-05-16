"""Regression tests for the /apk/ and /testing/ short URLs.

2026-05-16 · after closed-testing approval, both endpoints redirect
to Google Play instead of serving / linking the VPS-hosted APK file.
The contracts must stay:

  GET /apk/      → 302 to https://play.google.com/store/apps/details?id=ke.co.cryptopay.app
  GET /testing/  → 302 to https://play.google.com/apps/testing/ke.co.cryptopay.app

Existing share links (QR codes, SMS invites, social posts) all use
the short URLs · they must keep working through Play Store transition.
The Redis-backed download counter must still tick so admin dashboard
analytics survive the migration.
"""
from __future__ import annotations

import pytest
from django.test import TestCase, Client
from django.core.cache import cache


pytestmark = pytest.mark.django_db


class TestApkShortUrlRedirectsToPlayStore(TestCase):
    """The /apk/ endpoint was previously the entrypoint for direct
    APK downloads (302 → /download/cryptopay.apk). Now it points
    at the Play Store · same short URL, new destination."""

    def setUp(self):
        self.client = Client()
        cache.clear()

    def test_redirects_to_play_store(self):
        r = self.client.get("/apk/")
        assert r.status_code == 302
        assert r["Location"] == (
            "https://play.google.com/store/apps/details"
            "?id=ke.co.cryptopay.app"
        ), r["Location"]

    def test_no_caching_header(self):
        # Don't let caching proxies memoise the redirect destination ·
        # we want to rotate this when iOS ships and we conditionally
        # route by User-Agent.
        r = self.client.get("/apk/")
        assert "no-store" in r.get("Cache-Control", ""), r.get("Cache-Control")

    def test_counter_increments(self):
        # Same counter key the admin metrics dashboard reads.
        cache.delete("metrics:apk_downloads_total")
        self.client.get("/apk/")
        self.client.get("/apk/")
        self.client.get("/apk/")
        assert cache.get("metrics:apk_downloads_total") == 3


class TestPlayTestingShortUrl(TestCase):
    """New /testing/ short URL for the closed-testing alpha cohort.
    Distinct counter from /apk/ so we can tell early-access opt-in
    clicks apart from general install clicks in the dashboard."""

    def setUp(self):
        self.client = Client()
        cache.clear()

    def test_redirects_to_play_testing(self):
        r = self.client.get("/testing/")
        assert r.status_code == 302
        assert r["Location"] == (
            "https://play.google.com/apps/testing/ke.co.cryptopay.app"
        ), r["Location"]

    def test_no_caching_header(self):
        r = self.client.get("/testing/")
        assert "no-store" in r.get("Cache-Control", "")

    def test_distinct_counter(self):
        # /testing/ counter is SEPARATE from /apk/ counter
        # so the dashboard distinguishes early-access opt-ins from
        # general install clicks.
        cache.delete("metrics:apk_testing_invites_total")
        cache.delete("metrics:apk_downloads_total")
        self.client.get("/testing/")
        self.client.get("/testing/")
        self.client.get("/apk/")
        assert cache.get("metrics:apk_testing_invites_total") == 2
        assert cache.get("metrics:apk_downloads_total") == 1
