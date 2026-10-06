#!/usr/bin/env python3
"""Attach simple historical outcome labels to an exported benchmark CSV."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

try:
    import numpy as np
    import pandas as pd
except ModuleNotFoundError:  # pragma: no cover - exercised in minimal envs
    np = None
    pd = None


def label_outcomes(input_path: Path, output_path: Path) -> None:
    if pd is None or np is None:
        label_outcomes_without_pandas(input_path, output_path)
        return

    frame = pd.read_csv(input_path)
    frame["positive_24h"] = frame["outcomeReturn24hPct"] > 0
    frame["severe_drawdown_24h"] = frame["outcomeMaxDrawdown24hPct"] <= -50
    frame["outcome_bucket"] = np.select(
        [
            frame["outcomeReturn24hPct"] >= 50,
            frame["outcomeReturn24hPct"] >= 10,
            frame["outcomeReturn24hPct"] > -20,
        ],
        ["strong_positive", "positive", "mixed"],
        default="negative",
    )
    frame.to_csv(output_path, index=False)


def label_outcomes_without_pandas(input_path: Path, output_path: Path) -> None:
    with input_path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))

    for row in rows:
        outcome_return = float(row["outcomeReturn24hPct"])
        max_drawdown = float(row["outcomeMaxDrawdown24hPct"])
        row["positive_24h"] = str(outcome_return > 0)
        row["severe_drawdown_24h"] = str(max_drawdown <= -50)
        if outcome_return >= 50:
            row["outcome_bucket"] = "strong_positive"
        elif outcome_return >= 10:
            row["outcome_bucket"] = "positive"
        elif outcome_return > -20:
            row["outcome_bucket"] = "mixed"
        else:
            row["outcome_bucket"] = "negative"

    with output_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("research/data/benchmark.csv"))
    parser.add_argument("--output", type=Path, default=Path("research/data/benchmark_labeled.csv"))
    args = parser.parse_args()
    label_outcomes(args.input, args.output)


if __name__ == "__main__":
    main()
