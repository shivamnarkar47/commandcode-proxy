# Benchmarks

Local micro-benchmarks for proxy overhead only. No upstream API key was available, so there are no end-to-end generation benchmarks here — contributions with `COMMANDCODE_API_KEY` measurements (time-to-first-token, tok/s per model) are welcome.

## Environment

- Date: 2026-09-05 · Linux x86_64 · Bun 1.4.0
- Proxy: `bun run src/proxy.ts --daemon`, default port 18731, localhost only
- No auth key configured (health/models endpoints don't require one)

## Results

| Metric | Value | Method |
|--------|-------|--------|
| Cold start → first healthy `/health` | **~47 ms** | single run, 100 ms poll interval (upper bound ≈ 150 ms) |
| `GET /health` latency, p50 | **246 µs** | n=100, in-process `urllib`, warmed up |
| `GET /health` latency, p95 | **752 µs** | same run |
| `GET /health` latency, mean / max | **341 µs / 1338 µs** | same run |

Naive `curl`-loop measurement gives ~8 ms mean because it includes `curl` process-spawn overhead — the in-process numbers above are the proxy's actual cost.

## Reproduce

```sh
# cold start
rm -f .commandcode-proxy.pid commandcode-proxy.log
T0=$(date +%s%N); bun run daemon > /dev/null 2>&1
for i in $(seq 1 100); do curl -s --max-time 2 http://127.0.0.1:18731/health > /dev/null 2>&1 && break; sleep 0.1; done
echo "cold-start-to-healthy: $(( ($(date +%s%N)-T0)/1000000 ))ms"

# latency (isolated, in-process)
python3 -c "
import time, urllib.request, statistics
url = 'http://127.0.0.1:18731/health'
for _ in range(5): urllib.request.urlopen(url).read()
xs = sorted((lambda t0: (urllib.request.urlopen(url).read(), (time.perf_counter_ns()-t0)/1000)[1])(time.perf_counter_ns()) for _ in range(100))
print(f'p50={xs[50]:.0f}us p95={xs[94]:.0f}us mean={statistics.mean(xs):.0f}us max={xs[-1]:.0f}us')"

# cleanup
bun run stop; rm -f .commandcode-proxy.pid commandcode-proxy.log
```

## Limitations

- Localhost only; no network hops measured.
- No streaming/SSE throughput numbers (needs upstream key).
- Single machine, single run — treat as order-of-magnitude, not a stable baseline.
