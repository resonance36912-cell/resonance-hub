#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import os
import re
import sys
import tarfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = os.environ.get("PODMAN_API_URL", "http://ronsas-podman-api:2375").rstrip("/")
API_V = f"{API}/v1.40"
IMAGE = "docker.io/library/postgres:17-alpine"
MARKER = "RND_CONTROL_RUNTIME_VERIFY=PASS"
WORKSPACE = Path(os.environ.get("GITHUB_WORKSPACE", Path(__file__).resolve().parents[1]))


def request(
    method: str,
    path: str,
    *,
    payload: object | None = None,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> bytes:
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        if data is not None:
            raise ValueError("payload_and_data_are_mutually_exclusive")
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    req = Request(
        f"{API_V}{path}",
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.read()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Podman API {method} {path} failed: HTTP {exc.code}: {body}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"Podman API unavailable for {method} {path}: {exc}") from exc


def get_json(path: str) -> dict:
    return json.loads(request("GET", path).decode("utf-8"))


def container_logs(container: str) -> str:
    raw = request(
        "GET",
        f"/containers/{container}/logs?stdout=true&stderr=true&tail=all",
    )
    return raw.decode("utf-8", errors="replace").replace("\x00", "")


def wait_for_exec(exec_id: str, timeout_seconds: int = 180) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        state = get_json(f"/exec/{exec_id}/json")
        if not state.get("Running", False):
            return state
        time.sleep(0.1)
    raise RuntimeError(f"exec_timeout:{exec_id}")


def upload_file(container: str, source: Path, destination_dir: str = "/tmp") -> str:
    if not source.is_file():
        raise RuntimeError(f"missing_runtime_input:{source}")

    archive = io.BytesIO()
    file_bytes = source.read_bytes()
    with tarfile.open(fileobj=archive, mode="w") as tar:
        info = tarfile.TarInfo(source.name)
        info.size = len(file_bytes)
        info.mode = 0o644
        info.mtime = int(time.time())
        tar.addfile(info, io.BytesIO(file_bytes))
    archive.seek(0)

    request(
        "PUT",
        f"/containers/{container}/archive?{urlencode({'path': destination_dir})}",
        data=archive.getvalue(),
        headers={"Content-Type": "application/x-tar"},
    )
    return f"{destination_dir.rstrip('/')}/{source.name}"


def exec_command(container: str, command: list[str], label: str) -> str:
    created = json.loads(
        request(
            "POST",
            f"/containers/{container}/exec",
            payload={
                "AttachStdout": True,
                "AttachStderr": True,
                "Tty": True,
                "Cmd": command,
            },
        ).decode("utf-8")
    )
    exec_id = created["Id"]
    output = request(
        "POST",
        f"/exec/{exec_id}/start",
        payload={"Detach": False, "Tty": True},
        timeout=180,
    ).decode("utf-8", errors="replace")
    state = wait_for_exec(exec_id)
    if output:
        print(output, end="" if output.endswith("\n") else "\n", flush=True)
    if state.get("ExitCode") != 0:
        raise RuntimeError(f"{label}_failed:{state.get('ExitCode')}")
    return output


def apply_sql_file(container: str, source: Path, label: str) -> None:
    remote_path = upload_file(container, source)
    exec_command(
        container,
        [
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-f",
            remote_path,
        ],
        label,
    )


def wait_for_postgres(container: str) -> None:
    for _ in range(45):
        state = get_json(f"/containers/{container}/json").get("State", {})
        if not state.get("Running", False):
            print(container_logs(container)[-12000:], file=sys.stderr)
            raise RuntimeError(f"postgres_container_exited:{state.get('ExitCode')}")

        created = json.loads(
            request(
                "POST",
                f"/containers/{container}/exec",
                payload={
                    "AttachStdout": True,
                    "AttachStderr": True,
                    "Tty": True,
                    "Cmd": ["pg_isready", "-U", "postgres", "-d", "postgres"],
                },
            ).decode("utf-8")
        )
        exec_id = created["Id"]
        request(
            "POST",
            f"/exec/{exec_id}/start",
            payload={"Detach": False, "Tty": True},
            timeout=30,
        )
        if wait_for_exec(exec_id, timeout_seconds=30).get("ExitCode") == 0:
            return
        time.sleep(1)

    print(container_logs(container)[-12000:], file=sys.stderr)
    raise RuntimeError("postgres_not_ready")


def main() -> int:
    if not WORKSPACE.is_dir():
        raise RuntimeError(f"workspace_not_found:{WORKSPACE}")

    run_id = re.sub(r"[^A-Za-z0-9_.-]", "-", os.environ.get("GITHUB_RUN_ID", "local"))
    attempt = re.sub(
        r"[^A-Za-z0-9_.-]",
        "-",
        os.environ.get("GITHUB_RUN_ATTEMPT", "1"),
    )
    name = f"ronsas-rnd-control-{run_id}-{attempt}"

    request(
        "POST",
        f"/images/create?{urlencode({'fromImage': 'docker.io/library/postgres', 'tag': '17-alpine'})}",
        timeout=300,
    )

    try:
        request("DELETE", f"/containers/{name}?force=true&v=true", timeout=30)
    except RuntimeError as exc:
        if "404" not in str(exc):
            raise

    created = json.loads(
        request(
            "POST",
            f"/containers/create?{urlencode({'name': name})}",
            payload={
                "Image": IMAGE,
                "Env": ["POSTGRES_PASSWORD=postgres", "POSTGRES_DB=postgres"],
            },
        ).decode("utf-8")
    )
    container_id = created["Id"]

    try:
        request("POST", f"/containers/{container_id}/start")
        wait_for_postgres(container_id)

        inputs = [
            (
                WORKSPACE / "scripts" / "verify-governance-bootstrap.sql",
                "supabase_compat_bootstrap",
            ),
            (
                WORKSPACE / "scripts" / "verify-rnd-control-bootstrap.sql",
                "rnd_auth_bootstrap",
            ),
            (
                WORKSPACE
                / "supabase"
                / "migrations"
                / "20260527142651_24003604-7eb1-44e4-985f-8ce7fcb147a0.sql",
                "roles_migration",
            ),
            (
                WORKSPACE
                / "supabase"
                / "migrations"
                / "20260922071500_bridge_execution_core.sql",
                "bridge_core_migration",
            ),
            (
                WORKSPACE
                / "supabase"
                / "migrations"
                / "20260923203500_rnd_control_center_hardening.sql",
                "rnd_control_hardening_migration",
            ),
            (
                WORKSPACE / "scripts" / "verify-rnd-control-db.sql",
                "rnd_control_runtime_acceptance",
            ),
        ]

        for source, label in inputs:
            apply_sql_file(container_id, source, label)

        print(MARKER, flush=True)
        return 0
    finally:
        try:
            request(
                "DELETE",
                f"/containers/{container_id}?force=true&v=true",
                timeout=30,
            )
        except Exception as cleanup_error:
            print(
                f"warning: R&D control database container cleanup failed: {cleanup_error}",
                file=sys.stderr,
            )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"RND_CONTROL_RUNTIME_VERIFY=FAIL {exc}", file=sys.stderr)
        raise SystemExit(1)
