"""Fetch a remote video so it can be analysed locally.

Scope and intent
----------------
This module exists ONLY to ingest footage the submitter is authorised to
analyse - their own recordings, or footage of players who have consented.
It is not a tool for scraping or investigating arbitrary third parties.

To keep the analyzer non-accusatory by construction, this module:

* never captures or stores the uploader name, channel, or video title;
* identifies a clip only by an opaque hash of the URL (`clip_id`), so reports
  describe a *clip*, never a *person*.

Note that downloading videos may be restricted by the source platform's
terms of service. The caller is responsible for having the right to fetch
and analyse the content (see the `--i-have-rights` CLI attestation).
"""

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path


class FetchError(RuntimeError):
    """Raised when a remote clip cannot be fetched."""


def clip_id(url):
    """Opaque, stable identifier for a URL - carries no human-readable info."""
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def ytdlp_available():
    return shutil.which("yt-dlp") is not None


def fetch_video(url, dest_dir=None, max_height=720, timeout=600):
    """Download a remote video and return the local file path.

    Only video is downloaded (audio is not needed for analysis). Metadata
    such as title and uploader is deliberately not requested.
    """
    if not ytdlp_available():
        raise FetchError(
            "yt-dlp is not installed. Install it with: pip install yt-dlp")

    dest_dir = Path(dest_dir) if dest_dir else Path(
        tempfile.mkdtemp(prefix="gia_clip_"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(dest_dir / "clip.%(ext)s")

    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--no-write-info-json",
        "--no-write-comments",
        "-f", f"bv*[height<={max_height}]/b[height<={max_height}]/b",
        "--merge-output-format", "mp4",
        "-o", out_template,
        url,
    ]
    try:
        subprocess.run(cmd, check=True, timeout=timeout,
                       capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        raise FetchError(f"download timed out after {timeout}s")
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip().splitlines()
        msg = detail[-1] if detail else "unknown error"
        raise FetchError(f"yt-dlp failed: {msg[:300]}")

    files = sorted(p for p in dest_dir.glob("clip.*") if p.is_file())
    if not files:
        raise FetchError("download produced no video file")
    return files[0]
