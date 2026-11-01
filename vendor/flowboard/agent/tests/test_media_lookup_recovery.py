import json
import pytest
from flowboard.services import flow_batch as fb
from flowboard.services.flow_sdk import FlowSDK
from tests.batch_harness import BatchRecorder,batch_envelope,batch_error_envelope,listing_payload_text,media_urls_payload,operation_payload

OP='11111111-1111-4111-8111-111111111111'
MEDIA='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
OTHER='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'

def entry(mid=MEDIA,title='舞会 "标题"',flag=True):
 return [OP,None,None,[title,[123,0],flag,None,mid,'client',True],'project']

@pytest.mark.parametrize('escaped',[False,True])
def test_exact_entry_with_flag_and_escaped_title(escaped):
 raw=json.dumps([entry()],ensure_ascii=False,separators=(',',':'))
 if escaped: raw=json.dumps(raw,ensure_ascii=False)
 raw=raw[raw.index(OP):][:800]
 assert fb.find_media_id_in_text(raw,OP)==MEDIA

def test_missing_media_does_not_borrow_neighbour_uuid():
 raw=json.dumps([entry(None),['another',None,None,['next',[124,0],None,None,OTHER]]],separators=(',',':'))
 assert fb.find_media_id_in_text(raw,OP) is None

def test_truncated_entry_does_not_match_uuid_in_title():
 raw=json.dumps([entry(title='null,null,"'+OTHER+'"'+'x'*900)],separators=(',',':'))
 assert fb.find_media_id_in_text(raw[:800],OP) is None

@pytest.mark.asyncio
async def test_not_found_media_handle_is_retained_until_it_becomes_available():
 rec=BatchRecorder(responses={
  fb.RPC_OPERATION:[batch_envelope(fb.RPC_OPERATION,operation_payload(MEDIA))]*2,
  fb.RPC_PROJECT_MEDIA:[listing_payload_text(OP,MEDIA)],
  fb.RPC_MEDIA:[batch_error_envelope(fb.RPC_MEDIA, [5]),batch_envelope(fb.RPC_MEDIA,media_urls_payload(MEDIA))],
 })
 sdk=FlowSDK(client=rec)
 sdk._remember_operation(OP, '8b62385c-4916-4abd-b01f-b28173d8eb04')
 first=await sdk.check_async([OP])
 assert not first['operations'][0]['done']
 second=await sdk.check_async([OP])
 assert second['operations'][0]['done']
 assert second['operations'][0]['media_entries'][0]['media_id']==MEDIA
 assert len(rec.rpcs(fb.RPC_PROJECT_MEDIA)) == 1
