"""Regression tests for /api/v1/app/version/ · mobile version manifest.

2026-05-16 · the mobile app polls this on cold-start so users on
stale builds get an "Update available" banner. The contract is:

  GET /api/v1/app/version/?platform=android
    → 200
    → JSON: latest_version, latest_version_code,
            minimum_supported_version_code,
            force_update_below_version_code,
            store_url, release_notes

  GET /api/v1/app/version/?platform=ios
    → 200 with `available: false` (iOS not shipped yet · sentinel
       so the client skips the banner cleanly)

  GET /api/v1/app/version/?platform=windows  →  400

Public endpoint · MUST NOT require auth (pre-login users on a stale
build must still see the banner) and MUST NOT 500 even if the
settings are missing values.
"""
from __future__ import annotations

import pytest
from django.test import TestCase, Client, override_settings


pytestmark = pytest.mark.django_db


class TestAppVersionEndpoint(TestCase):
    def setUp(self):
        self.client = Client()

    def test_default_platform_is_android(self):
        # Mobile client may omit platform · we default to Android
        # (only platform shipped at time of writing). Apps that
        # forget to pass the param still get a sane response.
        r = self.client.get("/api/v1/app/version/")
        assert r.status_code == 200, r.content
        data = r.json()
        assert data["platform"] == "android", data
        assert data["available"] is True

    def test_android_payload_shape(self):
        r = self.client.get("/api/v1/app/version/?platform=android")
        assert r.status_code == 200
        data = r.json()
        # All keys the mobile client reads must be present · adding
        # a new key on the server is OK but removing one breaks
        # already-shipped builds.
        for key in (
            "platform",
            "available",
            "latest_version",
            "latest_version_code",
            "minimum_supported_version_code",
            "force_update_below_version_code",
            "store_url",
            "release_notes",
        ):
            assert key in data, f"missing key: {key}"

    def test_ios_sentinel(self):
        # iOS build not shipped yet · server returns `available: false`
        # so the client unconditionally skips the banner. Without this,
        # a future iOS rollout would silently push every existing iOS
        # tester into an update prompt for an Android-only versionCode.
        r = self.client.get("/api/v1/app/version/?platform=ios")
        assert r.status_code == 200
        data = r.json()
        assert data["platform"] == "ios"
        assert data["available"] is False
        assert data["latest_version_code"] is None

    def test_unknown_platform_400s(self):
        r = self.client.get("/api/v1/app/version/?platform=blackberry")
        assert r.status_code == 400

    def test_no_auth_required(self):
        # Pre-login users on a stale build MUST still get the manifest
        # so the auth screen can show an "Update needed" banner. The
        # mobile client hits this endpoint BEFORE we have an access
        # token in storage.
        # No Authorization header / no cookies → still 200.
        r = self.client.get("/api/v1/app/version/?platform=android")
        assert r.status_code == 200
        # And the response carries no auth-only data.
        body = r.json()
        assert "user" not in body
        assert "phone" not in body

    @override_settings(
        MOBILE_VERSION_LATEST_NAME="9.9.9",
        MOBILE_VERSION_LATEST_CODE=999,
        MOBILE_VERSION_MIN_SUPPORTED_CODE=900,
        MOBILE_VERSION_FORCE_BELOW_CODE=800,
        MOBILE_VERSION_STORE_URL="https://example.test/store/",
        MOBILE_VERSION_RELEASE_NOTES="Test release notes.",
    )
    def test_reflects_settings_overrides(self):
        # Ops can bump version metadata via .env without redeploying
        # backend · this test guarantees the endpoint never hard-codes
        # the values away from the settings.
        r = self.client.get("/api/v1/app/version/?platform=android")
        assert r.status_code == 200
        data = r.json()
        assert data["latest_version"] == "9.9.9"
        assert data["latest_version_code"] == 999
        assert data["minimum_supported_version_code"] == 900
        assert data["force_update_below_version_code"] == 800
        assert data["store_url"] == "https://example.test/store/"
        assert data["release_notes"] == "Test release notes."

    def test_versioncode_is_integer_not_string(self):
        # The mobile client compares as integers (`bundled < latest`).
        # If the server ever serialised these as strings, "21" < "9"
        # lexicographically, which would force every user to "update"
        # forever. Pin the type contract here.
        r = self.client.get("/api/v1/app/version/?platform=android")
        data = r.json()
        assert isinstance(data["latest_version_code"], int)
        assert isinstance(data["minimum_supported_version_code"], int)
        assert isinstance(data["force_update_below_version_code"], int)
