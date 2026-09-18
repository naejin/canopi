#!/usr/bin/env python3
"""Run the shell-level runner exit-handling tests under unittest discovery.

The behaviour under test is the aggregate runner's process exit status, which is
a shell contract. The assertions live in ``test_runner_exit.sh`` so they exercise
the real script with deterministic stubs; this wrapper makes them part of the
normal test run.
"""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "test_runner_exit.sh"


class RunnerExitHandling(unittest.TestCase):
    def test_runner_exit_handling(self) -> None:
        result = subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True,
                                timeout=300)
        self.assertEqual(result.returncode, 0,
                         f"runner exit handling failed:\n{result.stdout}\n{result.stderr}")
        self.assertIn("0 failed", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
