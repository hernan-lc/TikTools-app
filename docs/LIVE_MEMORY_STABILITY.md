# LIVE resource ownership and memory diagnostics

Current main-page projection and frame-scheduling work is described in
[LIVE_WEBVIEW_PROJECTION.md](LIVE_WEBVIEW_PROJECTION.md), including explicit
remaining real-LIVE and platform validation gates.

Historical audit baseline: `2f8f088c0817b1f5648ebc8222cc67d4e8fc3520` (`remake`).
Current draft refactor baseline: `79dd1ab193cf7e8e251575d44e0a6270f7814010`.
The full refactor remains incomplete; see [progress](PERFORMANCE_REFACTOR_PROGRESS.md)
and the dated validation section below for unresolved P0 defects.

## Policies implemented

| Resource | Bound and overload policy | Owner and cleanup |
| --- | --- | --- |
| Analytics admission | 1,024 queued records; one batch of at most 128. Admission waits for capacity. No per-event tasks or blocking workers. | AppCore owns one database writer thread and joins it at shutdown. The thread owns its reusable SQLite connection, never AppCore. |
| Analytics failures | Failed transactions retain their batch and retry, applying backpressure. Session admission and disconnect flush each have a 10-second deadline. | Accepted work flushes at shutdown. After the shutdown flush deadline, remaining work is written to a synced recovery file beside the analytics database. Recovery finishes before new admission. |
| Analytics recovery | At most one failed batch plus the bounded queue; serialized recovery has a 16 MiB safety bound. | Batch IDs prevent duplicate counters when recovery committed before file retirement. Successful normal batches retire their IDs; replay IDs retire after the recovery file does. |
| Plugin event delivery | Existing 64-event ordered queue and observable lossy/reliable-gap policy retained. | Observer continuously reaps JoinSet entries, reconciles inactive workers every 250 ms, and fences workers and loader admission to the runtime generation. |
| Plugin calls | 128 admitted calls per running plugin generation, including execution. Overload returns `PluginLoaderError::Overloaded` immediately. | A queued call owns an admission permit until consumption/cleanup. Stopped generations close admission, skip queued calls, and release permits. No extra blocking worker per caller. |
| VM wake notifications | At most one queued wake per VM. | Atomic pending flag clears before pumping. A callback during pumping schedules another wake. Idle native callback delivery remains supported. |
| Speech | One HTTP job in flight, 64 queued jobs. FIFO; full queue rejects new speech with an observable diagnostic rather than restarting the plugin. | One owned worker/runtime. Eligibility stays synchronous; voice lookup, voice selection, deduplication, and speech HTTP run in the worker. Admission timestamps preserve replay windows. Stop cancels HTTP and queued work, then joins the worker. |
| Desktop domain forwarding | Before Winit: 512 lossy snapshots/feed messages; 4,096 reliable messages / 16 MiB. Same classification/coalescing policy as the existing WebView outbox. | One shared mailbox and payload-free wake, with batches of 128. Reliable overflow records a gap and uses the existing fail-loud reload policy. |
| Plugin broker promises | 128 pending requests, 30-second timeout. | Timers clear on response, send failure, page teardown, or disposal. Teardown rejects promises and clears listeners. |
| Native broker tasks | 128 admitted tasks per window, 30-second deadline; oversized requests are rejected before copying/spawning. | Window teardown cancels tasks and closes admission. Window IDs fence responses/subscription effects; randomized request prefixes distinguish reloads. |
| LIVE pump | One owned task. | Shutdown cancellation interrupts receipt/admission, and AppCore joins the task. Broadcast lag records a health gap. |

Plugin call channels retain their existing runtime/ABI plumbing: a call must carry a permit, VM notifications coalesce, and shutdown bypasses admission. Consequently the underlying unbounded channel cannot accumulate unbounded call or wake payloads. Direct synchronous VM compatibility calls are serialized by their mutable instance owner.

The event worker awaits an in-flight loader deadline before exiting. Dropping that future prematurely would bypass process timeout retirement. Ordinary event delivery keeps the five-second deadline; existing first-process-call cold-start grace remains. Foreign native code cannot be forcibly interrupted safely through the existing ABI.

Database transactions fold counters in SQLite without retaining a viewer map. Session opens, samples, counter updates, and closes share the same FIFO writer. Recovery contains aggregate records/viewer identities, never private chat text or session credentials. Failure to write recovery (for example, a full/unwritable disk) is logged with the outstanding count; preservation cannot be guaranteed when storage itself fails. Session admission timeout is also explicit and marks a gap; it does not claim the session row was persisted.

## Safe runtime snapshot

Use the existing control API:

```sh
target/debug/tiktools rpc system.health '{}'
```

Added fields: `liveGeneration`, `automationActiveTasks`, `plugins.eventWorkers`, `plugins.outstandingCalls`, and `analytics` (`capacity`, `batchCapacity`, `queued`, `pending`, `batches`, `failures`, `overload`, `ready`, `stopping`). Existing event-gap, plugin-drop, plugin-health and transport-failure reporting remains available. These counters contain no request payloads, cookies, or chat text.

Opt-in Linux sampling (bounded to 3,600 samples):

```sh
bun scripts/profile-live-memory.ts --pid HOST_PID --samples 300 --interval 1 > memory.csv
```

The sampler reads RSS and process names, traverses children of all host threads, and polls `system.health`. It does not read process command arguments or environment variables. Child classification is heuristic: unidentified child processes appear in `other_child_rss_kib`. Missing health access is reported as `unavailable`; no CLI error payload is logged. Windows samples through the built-in CIM cmdlets (`pwsh`/`powershell`); no `psutil` install is required.

## Reproducible synthetic regression

```sh
cargo test -p tiktools-core --features persistence,native-tiktok --locked \
  synthetic_canonical_analytics_memory_cycles -- \
  --ignored --nocapture --test-threads=1
```

This opt-in Linux test converts synthetic canonical chat events into analytics records, writes 4,096 records per cycle, joins each writer, checks pending work returns to zero, and verifies exact totals after 24 cycles. After four warmup cycles it allows up to 16 MiB RSS growth for allocator caching. It measures the **test harness process**, not the complete host or a real TikTok connection. The regular suite also tests saturated/locked SQLite, pending shutdown/recovery, idempotent replay, multi-creator totals, 128 plugin restarts with stale generations, concurrent VM wake flooding, cancelled event queues, slow TTS/cancellation, and broker teardown/overflow.

Observed synthetic run: 98,304 canonical chat records, zero pending after every cleanup cycle, 32 transactions per cycle. Warm cycle 3 RSS: 19,240 KiB; cycles 4–23 never exceeded 19,240 KiB; final RSS: 8,060 KiB. There is no equivalent measured baseline run, so these figures are not a before/after leak comparison.

## Remaining validation and limitations

This work does not experimentally establish a real-TikTok leak or full-application steady-state memory stability. Complete the requested ten-scenario matrix on the running application: idle; no/one/multiple plugins; slow TTS; native VM callbacks; reconnects; plugin enable/disable; actual WebView cycles; and sustained storage/plugin overload. Record warm/load/post-cleanup RSS for the host and relevant child processes, together with health counters, and compare against the baseline build.

Native WebView smoke testing requires an actual display and `TIKTOOLS_TEST_NATIVE_WINDOWS=1`; its default test return is a skip, not evidence of GTK/WebView cleanup. Windows compatibility requires the repository CI/build environment. The main Playwright suite was run separately: 3 passed and 36 failed. A representative `globals.list` fake-host failure was reproduced on the unmodified audit baseline in an isolated checkout. Other failures (including widget selectors/screenshots) remain untriaged; the suite is not reported as passing.

The upstream native LIVE transport remains a 512-event broadcast stream. Sustained writer backpressure can make that receiver lag; the host now reports a gap, but missed upstream events are not replayable. Exact writer totals apply to admitted records. Lossless upstream ingestion/durable replay under arbitrarily slow storage remains unresolved.

Native/plugin code already executing can ignore deadlines or block indefinitely. Queued expired/cancelled work is suppressed, but safely interrupting arbitrary in-process foreign code requires cooperative runtime support or process isolation. Complete timeout/rejection/completion/restart metrics, per-plugin event queue depth, and transport byte/backlog diagnostics are not all exposed yet. The mailbox bounds domain forwarding; other proxy producers still need a complete transport-admission audit. These limitations prevent claiming every acceptance criterion in the full audit is closed.

Local validation also passed workspace format/Clippy, 583 workspace Rust tests, loader all-feature/native integration, 672 scoped frontend unit tests, frontend type-check/lint/build, and the Linux desktop build. Plain `bun test` picks up Playwright files and fails; one repeat crashed the installed Bun canary. Use the repository scoped script for the passing unit suite.

The processor sibling-isolation fake is explicitly modeled as native blocking code, with its original assertions retained. A real process-generation timeout/failure retires that generation and cancels queued sibling calls; the fake had previously declared process semantics while ignoring process deadlines.


## 2026-10-13 reliability branch validation

This branch is a draft refactor, not a completed memory-stability result.
Transport task ownership, original-generation admission, queue accounting,
fan-out uniqueness and frontend lifecycle cleanup have regression coverage.
The upstream signer exposes no join handle for its internal OS thread;
complete signer teardown and reconnect-in-progress visibility remain unresolved.
Points durable ordering/recovery, dirty-cache admission and plugin startup,
retired-worker ownership and uncooperative native isolation remain P0 work.

The latest analytics-only stress run applied 98,304 records over 24 joined
writer cycles: zero pending after each cleanup, 32 batches per cycle. Cycle 0
RSS was 19,528 KiB; cycles 1–23 were 19,784 KiB, including warm cycle 3.
These are post-cleanup samples of the test harness, not host idle/peak samples.
No full-host or child thread-count comparison and no real-LIVE measurement
has been collected. RSS remaining elevated after cleanup alone does not imply a leak.

The profiler now accepts `--label` and `--phase idle|load|cleanup`, and reports
host threads, CPU percentage and transport state/generation. Missing host RSS
is unknown rather than zero. `system.health.pid` prevents associating another
host's health with the sampled PID. Linux parsing regressions passed.

Native WebView open/close smoke testing was explicitly enabled on the configured
display and passed. The main Playwright suite had 3 passed and 36 failed. The
navigation `globals.list` fake-host failure was reproduced on the exact `79dd1ab`
baseline; other failures are untriaged and are not called pre-existing or passed.

## 2026-10-13 desktop transport and native retention follow-up

The new process-attributed native reproducer, measurements, validation and remaining
work are recorded in [the benchmark report](benchmarks/2026-10-13/REPORT.md).
This does not close the full Windows/real-LIVE acceptance matrix.

The Linux sampler preserves its existing columns and appends build identity, host
PID, process/thread counts, a process-tree RSS sum and aggregate desktop diagnostics.
A process-tree RSS sum **includes shared pages multiple times**; it is not private
memory or a unique physical-memory total. Compare the separate host/renderer
columns; do not interpret their sum as PSS. A missing or reused host remains unknown,
not zero RSS. Process arguments and environment variables are never collected.
Health data is accepted only for the requested host PID. Missing health does not
prevent OS sampling (use `--cli /nonexistent` for an isolated native test harness).
Health polling can extend the requested interval; use the actual elapsed column.

```sh
bun scripts/profile-live-memory.ts --pid HOST_PID --samples 300 --interval 1 \
  --commit VERIFIED_EXECUTABLE_SHA --label release-baseline --phase idle > idle.csv
# Windows (same script, no extra install):
bun scripts/profile-live-memory.ts --pid HOST_PID --samples 300 --interval 1 \
  --cli target/release/tiktools.exe --commit VERIFIED_EXECUTABLE_SHA \
  --label release-baseline --phase idle > idle-windows.csv
```

Windows association uses parent PID and creation time, including WebView2 children;
unrelated WebView2 instances are excluded. Windows sampling itself remains untested
on a Windows runner. If `health` says `pid_mismatch`, check which host the CLI
endpoint reaches; the sampler deliberately refuses to combine two hosts.
`host_exited_or_reused` means the original process identity is gone. A truncated
tree has reached the 256-process sampler bound; it is not a complete tree total.

`system.health.desktop` contains bounded mailbox/outbox counts, bytes, high-water
marks and drops; inbound capacity/in-flight/rejections/deadlines; page generation;
evaluation calls/bytes/errors; plugin window/backlog/in-flight counters; and native
IPC disconnections/external retained handles. UI-owned snapshots update every ten
seconds. `TIKTOOLS_DIAGNOSTICS=1` enables aggregate-only desktop logging at the same
cadence; normal runs emit no periodic diagnostic log. No payloads are included.

Main outbound admission is shared by legacy pushes, domain forwarding and RPC
responses before Winit. Reliable capacity remains 4,096 / 16 MiB; lossy capacity is
512 / 8 MiB, with a 1 MiB serialized item limit. A batch is at most 128 / 4 MiB.
Overflow fails the reliable transport rather than retaining an overflowing item.
Lossy shedding records `event.gap`/resync. Plugin progress is reliable. Bounded
serialization stops before allocating an oversized JSON output. One producer-owned
source value and a serialized candidate may still exist during admission.

Main inbound capacity is 128 requests, each subject to the existing request byte
limit. The 30-second deadline reports uncertain completion; it **does not cancel an
irreversible operation**. Admission remains held until that operation settles and
no second response is sent. Refresh authoritative state before retrying. Uncooperative
operations can therefore exhaust these finite slots; process isolation/cooperative
cancellation is still a separate concern. Responses are fenced by page generation.

Native broker permits cover execution **and** queued response/subscription commands:
at most 128 calls / 256 commands per window, responses limited to 1 MiB. There are
at most 32 open plugin windows. Per-window output uses the reliable 4,096 / 16 MiB
policy; arbitrary plugin events have no general resync contract and stay reliable.
At most four windows get one capped batch each per tick, in round-robin order.
A failed plugin output transport closes its owner instead of retrying side effects.

Native stress and event-delivery exercises require a real display:

```sh
TIKTOOLS_TEST_NATIVE_WINDOWS=1 TIKTOOLS_NATIVE_SMOKE_CYCLES=100 \
  TIKTOOLS_NATIVE_SMOKE_CLEANUP_SECONDS=30 \
  node scripts/cargo-with-linker.mjs test -p tiktools-desktop --release --locked smoke -- --nocapture
TIKTOOLS_TEST_NATIVE_WINDOWS=1 TIKTOOLS_NATIVE_SMOKE_CYCLES=1 \
  TIKTOOLS_NATIVE_SMOKE_MESSAGES=100000 \
  node scripts/cargo-with-linker.mjs test -p tiktools-desktop --release --locked smoke -- --nocapture
```

Cycles accept 1..500; event exercises accept up to 100,000 messages and acknowledge
ordered receipt from actual page JavaScript. For an isolated teardown A/B,
`TIKTOOLS_NATIVE_SMOKE_RETAIN_IPC=1` is a **test-binary-only** switch preserving the
old GTK signal ownership. It is unavailable in application builds. Always sample
from process start and keep the host alive during post-close cleanup.

GTK teardown unregisters the IPC message name and disconnects only
`script-message-received` handlers on the private content manager before dropping
Wry. The native child/display-sync/parent destroy ordering and external-destroy
`mem::forget` workarounds are preserved. External forgotten handles are counted;
repeated external destruction still represents retained application handles and
has not been proven safe to replace with unconditional drop.


### October 2026 desktop transport follow-up

Shared pre-Winit admission now enforces count/byte budgets, main inbound RPC has
128 permits, and prepared outbound batches carry generation/sequence acknowledgments.
Native plugin output is bounded and batched; Linux terminal teardown disconnects
the private IPC signal without changing native destroy ordering or the external
`mem::forget` workaround. Frontend feature and iframe owners dispose owned work.

See [measurements and remaining gates](benchmarks/2026-10-13/REPORT.md). The user
requested ending the task and skipping remaining complicated tests. Windows,
controlled LIVE matrices and repeated final-source release measurements remain
unvalidated; earlier prototype results must not be relabeled as final builds.
