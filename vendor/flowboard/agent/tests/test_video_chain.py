"""Regression cases from a live Flow submit and CHILD_SAFETY response."""
from unittest.mock import AsyncMock, Mock
import pytest
from flowboard.services import flow_batch as fb
from flowboard.services.flow_sdk import FlowSDK
from tests.batch_harness import BatchRecorder, batch_envelope, complaint_detail, media_urls_payload
from flowboard.db import get_session
from flowboard.db.models import Request
from flowboard.worker import processor
from flowboard import main

PID = "8b62385c-4916-4abd-b01f-b28173d8eb04"
SCENE = "11111111-1111-4111-8111-111111111111"
MEDIA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

def submission():
    # Submit [2] contains SCENES. Submit [3] contains MEDIA, including status.
    return [None, 885,
            [[SCENE, None, None, ["title", [123, 0], None, None, MEDIA, "client"], PID]],
            [[MEDIA, PID, SCENE, None, None, [None] * 8 + [None, [6], 1]]]]

@pytest.mark.asyncio
async def test_submit_preserves_media_handle_and_reports_real_rejection():
    rec = BatchRecorder(responses={
        fb.RPC_GEN_VIDEO_REFERENCES: batch_envelope(fb.RPC_GEN_VIDEO_REFERENCES, submission()),
        fb.RPC_OPERATION: batch_envelope(fb.RPC_OPERATION,
            [None, 885, [[MEDIA, PID, SCENE, None, None, complaint_detail("PUBLIC_ERROR_MINOR")]]]),
    })
    sdk = FlowSDK(client=rec)
    dispatch = await sdk.gen_video_omni("test", PID, ["reference"], 4)
    assert dispatch["remote_handles"] == [{"scene_id": SCENE, "media_id": MEDIA, "project_id": PID}]
    out = await sdk.check_async(dispatch["operation_names"])
    assert out["operations"][0]["error"] == "PUBLIC_ERROR_MINOR"
    assert out["operations"][0]["done"] is True
    assert rec.payload(fb.RPC_OPERATION) == [None, None, [[MEDIA]]]
    assert not rec.rpcs(fb.RPC_PROJECT_MEDIA)
    assert not rec.rpcs(fb.RPC_MEDIA)

@pytest.mark.asyncio
async def test_restored_checkpoint_polls_without_submitting_or_listing():
    rec = BatchRecorder(responses={
        fb.RPC_OPERATION: batch_envelope(fb.RPC_OPERATION, [None, 1, [media_urls_payload(MEDIA)]])
    })
    sdk = FlowSDK(client=rec)
    sdk.restore_video_dispatch({"submission_payload": submission(), "operation_names": [SCENE]}, PID)
    result = await sdk.check_async([SCENE])
    assert result["operations"][0]["done"] is True
    assert result["operations"][0]["media_entries"][0]["media_id"] == MEDIA
    assert [c["rpcid"] for c in rec.calls] == [fb.RPC_OPERATION]

@pytest.mark.asyncio
async def test_crash_recovery_never_replays_paid_generation(monkeypatch):
    dispatch = {"operation_names": [SCENE], "submission_payload": submission()}
    with get_session() as s:
        req = Request(type="gen_video_omni", status="running", params={"project_id": PID}, result={})
        s.add(req); s.commit(); s.refresh(req); rid = req.id
    processor._persist_video_progress({"__request_id": rid}, dispatch)
    queue = Mock()
    monkeypatch.setattr(main, "get_worker", lambda: queue)
    assert main._recover_orphan_running_requests() == 1
    queue.enqueue.assert_called_once_with(rid)
    sdk = Mock()
    sdk.gen_video_omni = AsyncMock(side_effect=AssertionError("MUST NOT RESUBMIT"))
    sdk.check_async = AsyncMock(return_value={"operations": [{"name": SCENE, "done": True, "error": "PUBLIC_ERROR_MINOR"}]})
    monkeypatch.setattr(processor, "get_flow_sdk", lambda: sdk)
    monkeypatch.setattr(processor, "VIDEO_POLL_INTERVAL_S", 0)
    await processor.WorkerController()._process_one(rid)
    sdk.gen_video_omni.assert_not_called()
    sdk.restore_video_dispatch.assert_called_once_with(dispatch, PID)
    with get_session() as s:
        req = s.get(Request, rid)
        assert req.status == "failed"
        assert req.error == "PUBLIC_ERROR_MINOR"
        assert req.result["raw_dispatch"] == dispatch


def test_uncheckpointed_or_canceled_requests_are_not_replayed(monkeypatch):
    with get_session() as s:
        s.add(Request(type="gen_video_omni", status="running", params={}, result={}))
        s.add(Request(type="gen_video_omni", status="canceled", params={}, result={"raw_dispatch": {"operation_names": [SCENE]}}))
        s.commit()
    queue = Mock(); monkeypatch.setattr(main, "get_worker", lambda: queue)
    assert main._recover_orphan_running_requests() == 1
    queue.enqueue.assert_not_called()

@pytest.mark.asyncio
async def test_upload_in_same_project_does_not_upload_again(monkeypatch):
    from flowboard.routes import upload
    from flowboard.services import media_project_sync
    from tests.test_upload import _png_bytes
    sdk = Mock()
    sdk.upload_image = AsyncMock(return_value={"media_id": MEDIA})
    monkeypatch.setattr(upload, "get_flow_sdk", lambda: sdk)
    monkeypatch.setattr(media_project_sync, "get_flow_sdk", lambda: sdk)
    uploaded = await upload._ingest_image_bytes(_png_bytes(), "image/png", PID, "test.png", None)
    assert await media_project_sync.ensure_media_in_project(uploaded["media_id"], PID) == MEDIA
    assert sdk.upload_image.await_count == 1
