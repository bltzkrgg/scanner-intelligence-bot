#!/usr/bin/env python3
"""Build a normalized benchmark CSV from exported token snapshots.

This script is intentionally file-based for the MVP. Feed it JSON records that
match the TypeScript TokenSnapshot shape plus outcome fields.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

try:
    import pandas as pd
except ModuleNotFoundError:  # pragma: no cover - exercised in minimal envs
    pd = None


REQUIRED_COLUMNS = {
    "mint",
    "marketCapUsd",
    "liquidityUsd",
    "ageMinutes",
    "top10HolderPct",
    "bundlerPct",
    "insiderPct",
    "sniperPct",
    "outcomeReturn24hPct",
    "outcomeMaxDrawdown24hPct",
}


def build_dataset(input_path: Path, output_path: Path) -> None:
    records = json.loads(input_path.read_text())
    if pd is None:
        build_dataset_without_pandas(records, output_path)
        return

    frame = pd.DataFrame.from_records(records)
    missing = REQUIRED_COLUMNS - set(frame.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    frame = frame.drop_duplicates(subset=["mint"]).copy()
    frame["liquidity_to_mcap"] = frame["liquidityUsd"] / frame["marketCapUsd"].clip(lower=1)
    frame.to_csv(output_path, index=False)


def build_dataset_without_pandas(records: list[dict], output_path: Path) -> None:
    if not records:
        raise ValueError("No records provided")
    missing = REQUIRED_COLUMNS - set(records[0])
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    seen = set()
    rows = []
    for record in records:
        if record["mint"] in seen:
            continue
        seen.add(record["mint"])
        row = dict(record)
        row["liquidity_to_mcap"] = float(row["liquidityUsd"]) / max(float(row["marketCapUsd"]), 1)
        rows.append(row)

    with output_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("research/data/benchmark.fixture.json"))
    parser.add_argument("--output", type=Path, default=Path("research/data/benchmark.csv"))
    args = parser.parse_args()
    build_dataset(args.input, args.output)


if __name__ == "__main__":
    main()
