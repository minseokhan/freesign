import json
import os
import stat
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STOP_CHECKS = ROOT / ".codex" / "hooks" / "stop-checks.sh"


def _write_fake_npm(bin_dir: Path, body: str):
    npm = bin_dir / "npm"
    npm.write_text(f"#!/bin/bash\n{body}", encoding="utf-8")
    npm.chmod(npm.stat().st_mode | stat.S_IXUSR)
    return npm


def _run_stop_checks(tmp_path: Path, npm_body: str):
    (tmp_path / "package.json").write_text('{"scripts": {}}', encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_fake_npm(bin_dir, npm_body)

    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    return subprocess.run(
        ["bash", str(STOP_CHECKS)],
        input='{"stop_hook_active": false}',
        text=True,
        cwd=tmp_path,
        env=env,
        capture_output=True,
        check=False,
    )


def test_stop_checks_runs_clean_build_between_lint_and_test(tmp_path):
    npm_body = """
set -e
echo "$@" >> calls.log
exit 0
"""

    result = _run_stop_checks(tmp_path, npm_body)

    assert result.returncode == 0
    assert json.loads(result.stdout) == {}
    assert (tmp_path / "calls.log").read_text(encoding="utf-8").splitlines() == [
        "run lint",
        "run build",
        "run test",
    ]


def test_stop_checks_reports_failing_stage_without_mixing_warnings(tmp_path):
    npm_body = """
if [ "$1 $2" = "run build" ]; then
  echo "Compiled with warnings"
  echo "Failed to collect page data for /contracts"
  exit 1
fi
echo "$1 $2 ok"
"""

    result = _run_stop_checks(tmp_path, npm_body)
    payload = json.loads(result.stdout)

    assert payload["decision"] == "block"
    assert "실패 단계: build" in payload["reason"]
    assert "Compiled with warnings" in payload["reason"]
    assert "lint: 통과" in payload["reason"]
    assert "test:" not in payload["reason"]


def test_stop_checks_classifies_vitest_local_listen_permission(tmp_path):
    npm_body = """
if [ "$1 $2" = "run test" ]; then
  echo "Error: listen EPERM: operation not permitted 127.0.0.1"
  exit 1
fi
echo "$1 $2 ok"
"""

    result = _run_stop_checks(tmp_path, npm_body)
    payload = json.loads(result.stdout)

    assert payload["decision"] == "block"
    assert "실패 단계: test" in payload["reason"]
    assert "샌드박스 로컬 리스닝 권한 문제" in payload["reason"]
