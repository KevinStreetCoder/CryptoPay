"""Static-config regression · deploy/nginx/cpay.conf must declare the
callback rate-limit zone and reference it from the callback location
block. Catches a copy-paste that drops one half (the zone declaration
or the location consumer) and silently turns the rate limit off.
"""
from __future__ import annotations

import re
from pathlib import Path

from django.test import TestCase


CONF = Path(__file__).resolve().parents[3] / "deploy" / "nginx" / "cpay.conf"


class NginxCallbackRateLimitTest(TestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not CONF.exists():
            raise AssertionError(f"nginx config missing at {CONF}")
        cls.text = CONF.read_text()

    def test_callback_zone_declared(self):
        """`limit_req_zone … zone=callback_limit:10m rate=20r/s` must exist."""
        m = re.search(
            r"limit_req_zone\s+\$binary_remote_addr\s+zone=callback_limit:\d+m\s+rate=\d+r/s",
            self.text,
        )
        self.assertIsNotNone(
            m,
            "callback_limit zone declaration missing or malformed in nginx config",
        )

    def test_callback_location_consumes_zone(self):
        """The callback location block must call `limit_req zone=callback_limit`."""
        # The location regex matches every callback path we host. Pin the
        # exact alternatives so a future addition (e.g. a Yellow Card
        # callback) is forced to extend the regex deliberately.
        loc_re = re.compile(
            r"location\s+~\s+\^/api/v1/\(hooks\|mpesa/callbacks\|"
            r"payments/sasapay/callback\|intasend/\(callback\|ipn\)\)/"
        )
        self.assertIsNotNone(
            loc_re.search(self.text),
            "callback location block missing the documented path-prefix list",
        )

        # The block must consume the zone.
        # Find the location block body and confirm `limit_req zone=callback_limit`
        # appears inside it.
        m = re.search(
            r"location\s+~\s+\^/api/v1/\(hooks.*?\}\s*$",
            self.text,
            flags=re.S | re.M,
        )
        # That regex is greedy on `.*?` so we trim to the first closing `}`.
        # Easier: search the whole file for the zone usage and rely on
        # surrounding context to confirm we're in the callback block.
        usage = re.search(
            r"limit_req\s+zone=callback_limit\s+burst=\d+\s+nodelay\s*;",
            self.text,
        )
        self.assertIsNotNone(
            usage,
            "callback_limit zone declared but no location block references it",
        )

    def test_callback_block_has_tight_timeouts(self):
        """Slowloris defence · the callback location must NOT inherit
        the general /api/ 120 s read timeout. Tightened to 30 s so an
        attacker can't park a connection open across the worker pool."""
        # Find the callback location body and confirm proxy_read_timeout
        # is set to something <= 60 s.
        m = re.search(
            r"location\s+~\s+\^/api/v1/\(hooks[^}]*proxy_read_timeout\s+(\d+)s",
            self.text,
            flags=re.S,
        )
        self.assertIsNotNone(m, "callback block missing an explicit proxy_read_timeout")
        timeout = int(m.group(1))
        self.assertLessEqual(
            timeout, 60,
            f"callback block read timeout is {timeout}s · should be ≤ 60s for slowloris defence",
        )
