# Ref2VA Turbo benchmark preparation

Status: End-to-end Turbo integration validated on 2026-11-01 through the
TapNow canvas. The existing Ref2VA base cache and pinned Turbo adapter restored
successfully from/to mert Drive. Native SGLang applied the adapter to 208 layers.
The gateway advertises `ref2va-turbo-4step` and enforces 544p / 4 steps.

The requested single 5-second test used 960×544, seed 42, one image and one
video reference, `reference_resize_mode=match`, and video/audio shifts 12/3.
The output decoded completely: H.264, 960×544, 124 frames at 24 fps, AAC stereo,
container duration 5.18 seconds. Measured server total was 174.727 seconds,
remote elapsed 160.750 seconds, transfer 7.548 seconds (cold startup excluded).
The 756437-byte file's SHA-256 was
`cf16f1cde556f4c36d0ebfa3f444bb14a503c283820cb346e2a3120ae64ba9c2`.
TapNow recorded the saved-result receipt; the 60-second idle watcher then
released the runtime automatically. Colab's session list showed no active
sessions at 2026-11-01 09:57 UTC. No manual release was used for this test.

This confirms the transport/save/release pipeline, not reference fidelity:
the requested replacement of the video person with the reference image was
not clearly achieved in this sample. The allocated GPU was RTX PRO 6000
Blackwell (96 GB), not H100. This environment fell back from FlashAttention
to Torch SDPA on SM12.x. No matched standard-model baseline was run; the
cancelled original 15-second job is not a valid speedup comparison.

`colab/prepare_ref2va_turbo.py` restores or downloads the pinned 1.29 GiB
LightX2V Ref2VA adapter, verifies SHA-256, then verifies a Drive backup. It does
not touch the running model. Copy it to `/content/tapnow-h3/` before use.
`colab/start_ref2va_turbo_benchmark.sh` is an experimental model-only launcher;
it rejects an existing session. `notebook_session.start` selects this launcher
for the Turbo profile and starts the normal token-protected gateway and release
watcher. Do not invoke the model-only launcher as a replacement for the notebook.

`colab/ref2va_benchmark_profiles.json` defines matched 5-second, 544p tests:
base 50 NFE versus Ref2VA Turbo 4 NFE, seed 42, identical prompt/references,
video/audio shifts 12/3 and `reference_resize_mode=match` for both. The exact
Ref2VA adapter requires alpha 8 and scale 1.0; do not substitute an FL2VA or
ComfyUI-format adapter. Startup uses SGLang's auto merge policy.

For future quality or speedup comparisons:

1. Verify the downloaded adapter and successful native Ref2VA LoRA loading.
2. Run both profiles with the same reference assets through the authenticated
   session service. Keep the user's auto-release preference enabled.
3. Download and validate each MP4 locally before sending its saved-result receipt.
4. Compare motion, identity/reference adherence, audio, and measured latency.
5. Advertise the active profile in the session response and validate its request
   settings before exposing a fast-mode selector. Never silently use 4 steps
   against the original model.

Current stock requests omit `reference_resize_mode`, so the pinned SGLang version
uses `diffusers` (2048 short edge). The Turbo author's `match` policy budgets
reference-image pixels to the target canvas and avoids upscaling. Fewer steps
and smaller references do not imply a fixed end-to-end speedup.

Sources:
- https://github.com/ModelTC/Minimax-H3-Turbo
- https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/inference_minimax_h3.py
- https://huggingface.co/lightx2v/Minimax-h3-Turbo/tree/30f485ed874aa44c8183348ad361c5eabad318da
- https://github.com/sgl-project/sglang/blob/45252c64ca8577fb842f953d57f85509a0aa104e/python/sglang/multimodal_gen/configs/sample/minimax_h3.py

## Structured-prompt retest (2026-11-01)

A second run kept the same references, seed 42, 960×544 canvas, 5-second
request, four NFEs and deployed backend. Only the prompt changed: it explicitly
defined the image cat as the sole subject, limited the video to motion and
scene reference, and requested removal of the original person and clothing.
Ten sampled frames spanning the output show a dancing long-haired cat rather
than the original human. This supports prompt specificity as a material factor
in the first failure; it does not establish pixel-exact motion/audio retention
or general reliability across inputs.

The second output is 5.18 seconds, H.264 960×544 at 24 fps with AAC audio.
Full decode passed. Total request-to-local-save time: 186.361 seconds, remote
elapsed: 164.488 seconds, download: 10.828 seconds (cold startup excluded).
Saved-result receipt confirmed 697413 bytes, SHA-256
`0548928c7c22d9207ab92b2f1b933362558d49aa6655419e9de8c867c7c514a0`.

The automatic release transitioned to `release_requested` after the saved receipt.
Colab then showed no active sessions; no manual GPU release was used.
