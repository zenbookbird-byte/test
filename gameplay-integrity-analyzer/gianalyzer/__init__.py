"""Gameplay Integrity Analyzer.

Heuristic, video-only anomaly screening for gameplay footage. The package
extracts motion and firing signals from a clip and reports statistical
anomalies (recoil flatness, aim-snap, reaction-time outliers).

IMPORTANT: results are screening signals for human review, NOT proof of
cheating. See README.md for the intended use and its limits.
"""

__version__ = "0.1.0"
