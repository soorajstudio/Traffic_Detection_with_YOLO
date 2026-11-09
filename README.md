# Traffic_Detection_with_YOLO

<p align="center">
  <img src="https://img.shields.io/badge/YOLO-v8-00FFFF?style=flat-square&logo=yolo" alt="YOLOv8" />
  <img src="https://img.shields.io/badge/PyTorch-Deep%20Learning-EE4C2C?style=flat-square&logo=pytorch" alt="PyTorch" />
  <img src="https://img.shields.io/badge/OpenCV-Computer%20Vision-5C3EE8?style=flat-square&logo=opencv" alt="OpenCV" />
  <img src="https://img.shields.io/badge/Flask-Python-black?style=flat-square&logo=flask" alt="Flask" />
  <img src="https://img.shields.io/badge/React-Frontend-61DAFB?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License" />
</p>

**NeuralVision Pro (PERCEPT)** is an autonomous perception and traffic analysis engine powered by YOLOv8, ByteTrack multi-object tracking, Flask, and React. Detect, track, and count vehicles, pedestrians, and cyclists from dashcam footage and traffic camera feeds in real time.

---

## 📸 Hero Preview

<p align="center">
  <img src="docs/screenshots/traffic-hero.png" width="100%" alt="NeuralVision Pro Traffic Perception Hero" />
</p>

## 🖼️ UI Snapshot Gallery

<p align="center">
  <img src="docs/screenshots/traffic-processing.png" width="49%" alt="Video Upload & Frame-by-Frame Processing" />
  <img src="docs/screenshots/traffic-detection.png" width="49%" alt="YOLOv8 Detection & Counting Results" />
</p>

---

## ✨ Features

- 🚗 **Multi-Class Vehicle Detection** - Accurately recognizes cars, buses, trucks, motorcycles, cyclists, and pedestrians with YOLOv8.
- 🎯 **ByteTrack Multi-Object Tracking** - Assigns persistent track IDs and maintains trajectory history across frames.
- 📊 **Bidirectional Traffic Counting** - Virtual trigger lines count inbound and outbound traffic flow automatically.
- ⚡ **Auto-Detect Hardware Acceleration** - Auto-selects NVIDIA CUDA GPU, Apple Silicon MPS, or multi-core CPU.
- 🎞️ **Frame-by-Frame Video Ingestion** - Upload dashcam MP4/AVI videos with automated H.264 re-encoding and playback.
- 🖥️ **Interactive Web Interface** - Modern React frontend with live progress telemetry and side-by-side video players.

---

## 🛠️ Tech Stack

- **Computer Vision & AI**: Ultralytics YOLOv8, ByteTrack, OpenCV, PyTorch
- **Backend API**: Flask, Flask-CORS, ImageIO-FFmpeg
- **Frontend Dashboard**: React, Vite, Tailwind CSS, Axios
- **Notebook & Research**: Jupyter Notebook (`vehicles-detection-and-counting.ipynb`)

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/soorajstudio/Traffic_Detection_with_YOLO.git
cd Traffic_Detection_with_YOLO
```

### 2. Start Backend (Flask)
```bash
pip install ultralytics torch torchvision opencv-python flask flask-cors
python app.py
```

### 3. Start Frontend (React)
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

Developed with ❤️ by [Sooraj Studio](https://github.com/soorajstudio).
