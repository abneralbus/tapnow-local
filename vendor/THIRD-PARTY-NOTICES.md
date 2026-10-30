# Media bridge source provenance

These directories are local copies of the user's existing providers, including the user's previous fixes. They contain source, tests, dependency descriptions and the Flow browser extension. They do not contain `.env`, databases, sessions, browser profiles, installed dependencies, account cookies or API-key files.

| Directory | Source | Base commit | License evidence |
| --- | --- | --- | --- |
| `flowboard` | https://github.com/crisng95/flowboard | `0aabdb349ba89aad62dccf59c3df78198a39ba3f` | The source has no LICENSE file. Its README says “MIT (proposed — license file pending).” This is an unresolved upstream license declaration, not a license grant supplied by this project. |
| `muse2api` | https://github.com/crisng95/muse2api; upstream author/repository www222fff/muse2api | `efc06dd9741efe3b56a4bb02bb4761c0003eae30` | MIT, copyright 2026 www222fff; original `muse2api/LICENSE` retained. |

Each `SOURCE-MANIFEST.json` records the original imported file hashes. The copied trees also include uncommitted local changes from the earlier project, so their content is not identical to the named upstream commit. No attempt was made to reset those changes.

Preserved local behavior includes Flow's single-submit asynchronous page-result recovery, explicit errors after page-context loss, media/polling result fixes, Muse multi-image video references, cookie handling and waiting for delayed media after the assistant's completion text. A callback timeout never authorizes resubmitting the same paid generation automatically.

TapNow's new startup and route-boundary code lives outside these trees, in `scripts/start-media-bridge.py` and `scripts/media_bridge_runtime.py`. Keep the unresolved Flowboard license status in mind before redistributing that upstream code; this local integration makes no claim of a new license grant.

## Additional local lifecycle changes on 2026-10-28

The `SOURCE-MANIFEST.json` hashes remain the immutable import baseline, not a claim that the following files are still byte-identical. Additional TapNow changes are recorded here:

- `muse2api/src/muse2api/drivers/browser/chromium.py`: suppress the startup window and blank URL; disable background throttling for background task pages; clean up a failed self-owned browser startup; wait after forced termination.
- `muse2api/src/muse2api/drivers/browser/driver.py`: request background task pages; close initial blank pages only inside a browser the driver itself spawned; leave attached external browsers untouched; close a target when page setup fails before it enters the task pool.
- `muse2api/tests/test_browser_lifecycle.py`: new offline regression tests for owned/attached browser behavior and failed-page cleanup.

The launcher now defaults to Flow only while Muse is paused, and follows the canvas Node lifecycle. Service processes each have an owned process group so shutdown can collect residual self-owned Chromium children without using broad Chrome process matching. These launcher changes do not modify the imported protocol implementation or its source hash baseline. No new paid Muse generation was submitted while making them.


## Portable sharing preparation (2026-10-30)

The launcher now reads private configuration from project-local `data/private/` and dependencies from `.venv/` by default. These paths are excluded from source exports. Muse service-key paths may be relative to `data/`. No upstream license declaration has been changed; the Flowboard license issue above remains unresolved for public redistribution.

## Credential cleanup (2026-10-30)

Removed the upstream hardcoded Google API key from `flow_client.py`. Legacy credits lookup now requires the optional private `FLOWBOARD_FLOW_API_KEY` setting and skips network access when absent. The current browser-based generation transport does not use this setting. Export validation rejects Google API key literals in all included source files, including vendor code.
