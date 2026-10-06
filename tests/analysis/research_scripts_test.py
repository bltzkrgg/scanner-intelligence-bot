import json
import tempfile
import unittest
from pathlib import Path

from research.scripts.build_dataset import build_dataset
from research.scripts.label_outcomes import label_outcomes


class ResearchScriptsTest(unittest.TestCase):
    def test_build_and_label_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            built = root / "benchmark.csv"
            labeled = root / "labeled.csv"
            source.write_text(json.dumps([
                {
                    "mint": "A",
                    "marketCapUsd": 100,
                    "liquidityUsd": 20,
                    "ageMinutes": 30,
                    "top10HolderPct": 25,
                    "bundlerPct": 5,
                    "insiderPct": 4,
                    "sniperPct": 8,
                    "outcomeReturn24hPct": 12,
                    "outcomeMaxDrawdown24hPct": -20,
                }
            ]))

            build_dataset(source, built)
            label_outcomes(built, labeled)

            content = labeled.read_text()
            self.assertIn("positive_24h", content)
            self.assertIn("positive", content)


if __name__ == "__main__":
    unittest.main()
