function selectCodexDailyUsageBucket(buckets, today) {
  const validBuckets = (Array.isArray(buckets) ? buckets : [])
    .filter((bucket) => typeof bucket?.startDate === "string" && Number.isFinite(Number(bucket.tokens)));
  const todayBucket = validBuckets.find((bucket) => bucket.startDate === today);
  if (todayBucket) return { bucket: todayBucket, isToday: true };
  const latestBucket = [...validBuckets].sort((left, right) => right.startDate.localeCompare(left.startDate))[0] || null;
  return { bucket: latestBucket, isToday: false };
}

module.exports = { selectCodexDailyUsageBucket };
