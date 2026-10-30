"""Measure native H3 submit-to-downloaded-MP4 latency without the canvas UI."""
import argparse
import json
import os
import pathlib
import re
import time
import urllib.error
import urllib.request

PROMPT = 'At dawn in a pine forest, a red fox walks slowly through thin mist. A low camera tracks forward smoothly. Soft backlight, realistic fur. Gentle wind and birdsong.'
PAYLOAD = {
    'model': 'MiniMaxAI/MiniMax-H3', 'prompt': PROMPT, 'seconds': 4,
    'task': 't2va', 'conditions': [],
    'target': {'short_edge': 768, 'aspect_ratio': '16:9', 'duration_seconds': 4.0},
    'num_outputs_per_prompt': 1, 'num_inference_steps': 50,
    'flow_shift': 12.0, 'audio_flow_shift': 3.0, 'seed': 42, 'quality': 'lossless',
}


def request(base, route, token, payload=None):
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    body = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(payload).encode()
    return urllib.request.urlopen(urllib.request.Request(base + route, data=body, headers=headers), timeout=60)


def measure(base, output, label, token):
    started = time.perf_counter()
    with request(base, '/v1/videos', token, PAYLOAD) as response:
        job = json.load(response)
    submitted = time.perf_counter()
    job_id = job['id']
    if not isinstance(job_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', job_id):
        raise ValueError('Invalid remote job ID')
    while job['status'] != 'completed':
        if job['status'] == 'failed':
            raise RuntimeError(json.dumps(job.get('error', job), ensure_ascii=False))
        if time.perf_counter() - started > 1800:
            raise TimeoutError('30 minutes elapsed; remote GPU work may still be running')
        time.sleep(.5)
        with request(base, '/v1/videos/' + job_id, token) as response:
            job = json.load(response)
    generated = time.perf_counter()
    target = output / (label + '.mp4')
    temp = target.with_suffix('.mp4.part')
    try:
        with request(base, '/v1/videos/' + job_id + '/content', token) as response, temp.open('wb') as dest:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 250 * 1024 * 1024:
                    raise ValueError('Video exceeds 250 MiB')
                dest.write(chunk)
        with temp.open('rb') as video:
            header = video.read(12)
        if size < 12 or header[4:8] != b'ftyp':
            raise ValueError('Response is not a valid MP4 container')
        temp.replace(target)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    finished = time.perf_counter()
    result = {'label': label, 'request': PAYLOAD, 'job': job,
              'submitMs': round((submitted-started)*1000),
              'generationAndPollingMs': round((generated-submitted)*1000),
              'downloadMs': round((finished-generated)*1000),
              'totalMs': round((finished-started)*1000), 'bytes': size,
              'scope': 'API submit to complete MP4 download; excludes browser decode',
              'pollIntervalMs': 500, 'measuredAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    (output / (label + '.json')).write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps({k: result[k] for k in ('label', 'submitMs', 'generationAndPollingMs', 'downloadMs', 'totalMs', 'bytes')}))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:30020')
    parser.add_argument('--output', default='/content/h3-benchmarks')
    parser.add_argument('--label', default='cold-standard-4s-768p')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        import io
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory)
            with patch(__name__ + '.request', side_effect=[
                io.BytesIO(b'{"id":"video_1","status":"completed"}'), io.BytesIO(b'<html>error</html>')
            ]):
                try:
                    measure('http://mock', output, 'invalid', '')
                    raise AssertionError('HTML must not produce a completed benchmark')
                except ValueError:
                    assert not list(output.iterdir())
            with patch(__name__ + '.request', return_value=io.BytesIO(b'{"id":"../../secret","status":"completed"}')):
                try:
                    measure('http://mock', output, 'invalid-id', '')
                    raise AssertionError('Unsafe job ID must be rejected')
                except ValueError:
                    assert not list(output.iterdir())
        print('benchmark failure-path checks passed (no GPU inference)')
    else:
        output = pathlib.Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', args.label):
            raise SystemExit('Label must use only letters, digits, hyphens, or underscores')
        measure(args.base.rstrip('/'), output, args.label, os.environ.get('H3_PROXY_TOKEN', ''))
