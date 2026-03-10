"""
PERCEPT backend — Flask + YOLOv8
Windows-safe: writes mp4v first, re-encodes to H.264 with ffmpeg if available.
ByteTrack requires `pip install lap` — falls back to predict() if unavailable.
"""

import os
import sys
import subprocess
import shutil
import cv2
import json
import base64
import time
import threading
import numpy as np
import torch
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from ultralytics import YOLO

# ── Auto-detect best available device ────────────────────────────
if torch.cuda.is_available():
    DEVICE = 'cuda'
    print(f"✅  GPU detected: {torch.cuda.get_device_name(0)} — using CUDA")
elif torch.backends.mps.is_available():
    DEVICE = 'mps'      # Apple Silicon
    print("✅  Apple Silicon GPU — using MPS")
else:
    DEVICE = 'cpu'
    print("⚠️   No GPU found — using CPU")

# ── Auto-install imageio-ffmpeg so H.264 re-encode always works ──
try:
    import imageio_ffmpeg as _iff
    print(f"✅  imageio-ffmpeg ready: {_iff.get_ffmpeg_exe()}")
except ImportError:
    print("[PERCEPT] Installing imageio-ffmpeg (one-time, ~30 MB)...")
    subprocess.check_call([sys.executable, '-m', 'pip', 'install',
                           'imageio-ffmpeg', '-q'])
    import imageio_ffmpeg as _iff
    print(f"✅  imageio-ffmpeg installed: {_iff.get_ffmpeg_exe()}")
try:
    import lap  # noqa
    HAS_LAP = True
except ImportError:
    print("[PERCEPT] 'lap' not found — installing now (needed for ByteTrack)...")
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'lap', '-q'])
    try:
        import lap  # noqa
        HAS_LAP = True
        print("[PERCEPT] 'lap' installed successfully.")
    except ImportError:
        HAS_LAP = False
        print("[PERCEPT] 'lap' install failed — tracker disabled, using predict() instead.")

# ── Flask setup ──────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'outputs'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# ── YOLO class map ───────────────────────────────────────────────
CLASS_IDS = {
    0:  'pedestrians',
    1:  'bicycles',
    2:  'cars',
    3:  'motorcycles',
    5:  'buses',
    7:  'trucks',
    9:  'traffic_lights',
    14: 'animals', 15: 'animals', 16: 'animals', 17: 'animals',
    18: 'animals', 19: 'animals', 20: 'animals', 21: 'animals',
    22: 'animals', 23: 'animals',
}
TARGET_CLASSES = sorted(set(CLASS_IDS.keys()))

# ── Job state store ──────────────────────────────────────────────
_job      = {}
_job_lock = threading.Lock()


# ── Helpers ──────────────────────────────────────────────────────

def find_working_fourcc(width, height, fps, test_path):
    """
    Try codecs in order. Writes a real dummy frame to confirm the codec
    actually produces bytes — avoids the silent avc1/openh264 failure on Windows.
    Returns (fourcc_code, ext).
    """
    candidates = [
        (cv2.VideoWriter_fourcc(*'mp4v'), '.mp4'),   # always works on Windows
        (cv2.VideoWriter_fourcc(*'XVID'), '.avi'),
        (cv2.VideoWriter_fourcc(*'MJPG'), '.avi'),
        (cv2.VideoWriter_fourcc(*'DIVX'), '.avi'),
    ]
    dummy = np.zeros((height, width, 3), dtype=np.uint8)
    for fourcc, ext in candidates:
        tmp = test_path + '_probe' + ext
        try:
            w = cv2.VideoWriter(tmp, fourcc, max(fps, 1), (width, height))
            if w.isOpened():
                w.write(dummy)
                w.release()
                size = os.path.getsize(tmp) if os.path.exists(tmp) else 0
                if os.path.exists(tmp):
                    os.remove(tmp)
                if size > 100:   # file must have actual content
                    tag = ''.join([chr((fourcc >> (8*i)) & 0xFF) for i in range(4)])
                    print(f"[PERCEPT] Codec selected: {tag.strip()} → {ext}")
                    return fourcc, ext
            else:
                w.release()
        except Exception as ex:
            print(f"[PERCEPT] Codec probe failed for {ext}: {ex}")
    # Absolute fallback — mp4v is almost always fine
    print("[PERCEPT] WARNING: All probes inconclusive, forcing mp4v")
    return cv2.VideoWriter_fourcc(*'mp4v'), '.mp4'


def reencode_to_h264(src_path, dst_path):
    """Re-encode to H.264 using imageio-ffmpeg (always available after startup)."""
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ffmpeg = shutil.which('ffmpeg')

    if not ffmpeg:
        print("[PERCEPT] No ffmpeg — browser may not play video.")
        return src_path

    try:
        cmd = [ffmpeg, '-y', '-i', src_path,
               '-vcodec', 'libx264', '-crf', '23',
               '-preset', 'fast', '-pix_fmt', 'yuv420p', dst_path]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=600, check=True)
        print(f"[PERCEPT] Re-encoded to H.264: {dst_path}")
        return dst_path
    except Exception as e:
        print(f"[PERCEPT] ffmpeg failed ({e}) — using original.")
        return src_path


def estimate_speed(cx_prev, cy_prev, cx_curr, cy_curr, fps, frame_width):
    """Rough speed in km/h from centre-point displacement between frames."""
    px_disp = ((cx_curr - cx_prev)**2 + (cy_curr - cy_prev)**2) ** 0.5
    mpp = 12.0 / frame_width   # metres per pixel (assumes ~12 m lane width)
    speed_kmh = px_disp * mpp * fps * 3.6
    if 1 < speed_kmh < 200:
        return round(speed_kmh, 1)
    return None


# ── Core processing function (runs in background thread) ─────────

def process_video_yolo(job_id, input_path, raw_output_path):
    try:
        _process(job_id, input_path, raw_output_path)
    except Exception as e:
        import traceback
        traceback.print_exc()
        with _job_lock:
            _job[job_id]['error'] = str(e)
            _job[job_id]['done']  = True


def _process(job_id, input_path, raw_output_path):
    model = YOLO('yolov8n.pt')
    model.to(DEVICE)   # move model to GPU (or CPU fallback)
    print(f"[PERCEPT] Model loaded on: {DEVICE}")

    cap          = cv2.VideoCapture(input_path)
    width        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps          = int(cap.get(cv2.CAP_PROP_FPS)) or 25
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_sec = total_frames / fps if fps > 0 else 0

    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {input_path}")

    # Find a codec that actually works on this machine
    fourcc, ext = find_working_fourcc(width, height, fps, raw_output_path)
    raw_out_with_ext = raw_output_path + ext
    writer = cv2.VideoWriter(raw_out_with_ext, fourcc, fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError("VideoWriter failed to open even after codec probe.")

    print(f"[PERCEPT] Writing with fourcc={fourcc}, ext={ext}")

    # ── Counting line at 55% frame height ────────────────────────
    LINE_Y      = int(height * 0.55)
    LINE_COLOR  = (0, 255, 255)   # cyan in BGR

    # State
    unique_ids   = {}   # class_name -> set of track_ids (or synthetic keys)
    prev_centers = {}   # track_id   -> (cx, cy)
    speed_samples= []
    frame_vehicle_counts = []
    crossed_ids  = {}   # track_id -> class_name  (only counted once per ID)

    use_tracker = HAS_LAP   # only attempt ByteTrack if lap is installed
    tracker_failed = False
    frame_idx   = 0

    with _job_lock:
        _job[job_id].update({
            'total_frames': total_frames,
            'frame':        0,
            'done':         False,
            'error':        None,
            'preview_jpeg': None,
        })

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

        # ── Run YOLO ─────────────────────────────────────────────
        if use_tracker and not tracker_failed:
            try:
                results = model.track(
                    frame,
                    classes=TARGET_CLASSES,
                    persist=True,
                    verbose=False,
                    tracker='bytetrack.yaml',
                    device=DEVICE,
                )
            except Exception as ex:
                print(f"[PERCEPT] Tracker error: {ex} — falling back to predict()")
                tracker_failed = True
                results = model.predict(frame, classes=TARGET_CLASSES, verbose=False, device=DEVICE)
        else:
            results = model.predict(frame, classes=TARGET_CLASSES, verbose=False, device=DEVICE)

        annotated = results[0].plot(conf=False)

        # ── Draw counting line ────────────────────────────────────
        cv2.line(annotated, (0, LINE_Y), (width, LINE_Y), LINE_COLOR, 2)
        cv2.putText(annotated, 'COUNT LINE', (10, LINE_Y - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, LINE_COLOR, 1, cv2.LINE_AA)

        # ── Collect stats ─────────────────────────────────────────
        boxes = results[0].boxes
        frame_vehicle_count = 0

        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                cls_id     = int(box.cls[0])
                class_name = CLASS_IDS.get(cls_id, 'other')
                unique_ids.setdefault(class_name, set())

                track_id = None
                if (use_tracker and not tracker_failed
                        and box.id is not None):
                    track_id = int(box.id[0])
                    unique_ids[class_name].add(track_id)
                else:
                    # No tracker: synthetic key to avoid double-counting within frame
                    synthetic = f"{frame_idx}_{cls_id}_{len(unique_ids[class_name])}"
                    unique_ids[class_name].add(synthetic)

                if class_name in ('cars', 'trucks', 'buses', 'motorcycles'):
                    frame_vehicle_count += 1

                if track_id is not None:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    cx = (x1 + x2) / 2
                    cy = (y1 + y2) / 2

                    prev = prev_centers.get(track_id)

                    # Speed (vehicles only)
                    if class_name in ('cars', 'trucks', 'buses', 'motorcycles') and prev:
                        spd = estimate_speed(prev[0], prev[1], cx, cy, fps, width)
                        if spd:
                            speed_samples.append(spd)

                    # Counting line crossing (downward, first time only)
                    if class_name in ('cars', 'trucks', 'buses', 'motorcycles',
                                      'pedestrians', 'bicycles'):
                        if (prev is not None
                                and prev[1] < LINE_Y <= cy
                                and track_id not in crossed_ids):
                            crossed_ids[track_id] = class_name
                            # Flash a small marker on the frame
                            cv2.circle(annotated, (int(cx), LINE_Y), 8,
                                       (0, 255, 0), -1)

                    prev_centers[track_id] = (cx, cy)

        frame_vehicle_counts.append(frame_vehicle_count)
        writer.write(annotated)
        frame_idx += 1

        # Push progress + JPEG preview every 10 frames
        if frame_idx % 10 == 0 or frame_idx == total_frames:
            _, buf = cv2.imencode('.jpg', annotated,
                                  [cv2.IMWRITE_JPEG_QUALITY, 60])
            jpeg_b64 = base64.b64encode(buf).decode('utf-8')
            with _job_lock:
                _job[job_id]['frame']        = frame_idx
                _job[job_id]['preview_jpeg'] = jpeg_b64

    cap.release()
    writer.release()

    # ── Re-encode to H.264 for browser playback ───────────────────
    h264_path = raw_output_path + '_h264.mp4'
    final_path = reencode_to_h264(raw_out_with_ext, h264_path)

    # ── Build stats ───────────────────────────────────────────────
    counts    = {k: len(v) for k, v in unique_ids.items()}
    avg_speed = round(float(np.mean(speed_samples)), 1) if speed_samples else None
    max_speed = round(float(np.max(speed_samples)),  1) if speed_samples else None

    crossed_counts = {}
    for cname in crossed_ids.values():
        crossed_counts[cname] = crossed_counts.get(cname, 0) + 1

    vehicles_crossed = sum(
        crossed_counts.get(c, 0)
        for c in ('cars', 'trucks', 'buses', 'motorcycles')
    )

    # Traffic density: vehicles per minute crossing the line
    vpm = vehicles_crossed / (duration_sec / 60) if duration_sec > 0 else 0
    if vpm >= 20:
        traffic_density, traffic_status = 'HIGH',     'CONGESTED'
    elif vpm >= 8:
        traffic_density, traffic_status = 'MODERATE', 'FLOWING'
    else:
        traffic_density, traffic_status = 'LOW',      'CLEAR'

    total_vehicles = sum(
        counts.get(c, 0) for c in ('cars', 'trucks', 'buses', 'motorcycles')
    )

    mins = int(duration_sec // 60)
    secs = int(duration_sec  % 60)

    stats = {
        'cars':                  counts.get('cars',          0),
        'pedestrians':           counts.get('pedestrians',   0),
        'trucks':                counts.get('trucks',        0),
        'buses':                 counts.get('buses',         0),
        'motorcycles':           counts.get('motorcycles',   0),
        'bicycles':              counts.get('bicycles',      0),
        'traffic_lights':        counts.get('traffic_lights',0),
        'animals':               counts.get('animals',       0),
        'avg_speed':             avg_speed,
        'max_speed':             max_speed,
        'total_vehicles':        total_vehicles,
        'vehicles_crossed_line': vehicles_crossed,
        'vehicles_per_minute':   round(vpm, 1),
        'traffic_density':       traffic_density,
        'traffic_status':        traffic_status,
        'crossed_counts':        crossed_counts,
        'duration':              f"{mins}:{str(secs).zfill(2)}",
        'fps':                   fps,
        'resolution':            f"{width}\u00d7{height}",
        'total_frames':          total_frames,
        'total_detections':      sum(counts.values()),
        'tracker_used':          (use_tracker and not tracker_failed),
    }

    # Read and base64-encode the final video
    with open(final_path, 'rb') as f:
        video_b64 = base64.b64encode(f.read()).decode('utf-8')

    with _job_lock:
        _job[job_id]['frame']        = total_frames
        _job[job_id]['done']         = True
        _job[job_id]['stats']        = stats
        _job[job_id]['video_b64']    = video_b64
        _job[job_id]['preview_jpeg'] = None


# ── Routes ───────────────────────────────────────────────────────

@app.route('/start-job', methods=['POST'])
def start_job():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    file = request.files['video']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    job_id      = str(int(time.time() * 1000))
    input_path  = os.path.join(UPLOAD_FOLDER, f"{job_id}_{file.filename}")
    # raw_output_path is a base — codec probe will append the real extension
    raw_output  = os.path.join(OUTPUT_FOLDER, f"raw_{job_id}")
    file.save(input_path)

    with _job_lock:
        _job[job_id] = {
            'total_frames': 1, 'frame': 0,
            'done': False, 'error': None,
            'preview_jpeg': None,
            'filename': file.filename,
        }

    t = threading.Thread(
        target=process_video_yolo,
        args=(job_id, input_path, raw_output),
        daemon=True,
    )
    t.start()
    return jsonify({'job_id': job_id})


@app.route('/stream/<job_id>')
def stream(job_id):
    """SSE — pushes JSON progress every 250 ms until the job finishes.
    CORS headers are set manually here because flask-cors sometimes
    drops them on streaming responses."""
    def generate():
        # Send a comment immediately so the browser knows the connection is alive
        yield ": connected\n\n"
        while True:
            with _job_lock:
                job = dict(_job.get(job_id, {}))

            if not job:
                yield f"data: {json.dumps({'error': 'job not found'})}\n\n"
                break

            payload = {
                'frame':        job.get('frame', 0),
                'total_frames': job.get('total_frames', 1),
                'done':         job.get('done', False),
                'error':        job.get('error'),
                'preview_jpeg': job.get('preview_jpeg'),
            }

            if job.get('done'):
                payload['stats']     = job.get('stats')
                payload['video_b64'] = job.get('video_b64')
                payload['filename']  = job.get('filename')

            yield f"data: {json.dumps(payload)}\n\n"

            if job.get('done') or job.get('error'):
                break

            time.sleep(0.25)

    resp = Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
    )
    # Explicit CORS + no-buffer headers — critical for EventSource to work
    resp.headers['Access-Control-Allow-Origin']  = '*'
    resp.headers['Access-Control-Allow-Headers'] = '*'
    resp.headers['Cache-Control']                = 'no-cache, no-store, must-revalidate'
    resp.headers['X-Accel-Buffering']            = 'no'
    resp.headers['Connection']                   = 'keep-alive'
    return resp


@app.route('/health')
def health():
    """Quick ping so the frontend can check the server is up."""
    return jsonify({'status': 'ok', 'device': DEVICE, 'tracker': HAS_LAP})


# Fallback for any stray GET that hits /api/* (avoids 404 noise in logs)
@app.route('/api/<path:path>', methods=['GET', 'POST'])
def api_catch(path):
    return jsonify({'status': 'ok', 'path': path})


if __name__ == '__main__':
    print("\n" + "="*55)
    print("  PERCEPT backend starting…")
    print(f"  Device  : {DEVICE}")
    print(f"  Tracker : {'ByteTrack (lap installed)' if HAS_LAP else 'Disabled (pip install lap)'}")
    print("  URL     : http://127.0.0.1:5000")
    print("  Health  : http://127.0.0.1:5000/health")
    print("="*55 + "\n")
    # host='0.0.0.0' lets React (even on a different port) reach the server
    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)