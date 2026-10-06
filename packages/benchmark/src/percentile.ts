export function percentileRank(
  values: number[],
  value: number,
  direction: "higher_is_better" | "lower_is_better"
): number {
  if (values.length === 0) return 50;

  const betterOrEqual = values.filter((candidate) => {
    if (direction === "higher_is_better") return value >= candidate;
    return value <= candidate;
  }).length;

  return Math.round((betterOrEqual / values.length) * 100);
}
