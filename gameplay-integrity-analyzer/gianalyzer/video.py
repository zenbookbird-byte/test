"""Video input: a thin wrapper over OpenCV's VideoCapture."""

import cv2


class VideoReader:
    """Iterates a video file, yielding downscaled BGR frames."""

    def __init__(self, path, work_width, stride=1, max_frames=0):
        self.cap = cv2.VideoCapture(str(path))
        if not self.cap.isOpened():
            raise FileNotFoundError(f"Could not open video: {path}")

        self.path = str(path)
        self.src_fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.src_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or work_width
        self.src_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or work_width
        self.src_count = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))

        self.stride = max(1, int(stride))
        self.work_width = int(work_width)
        self.work_height = int(round(self.src_height * self.work_width / self.src_width))
        self.eff_fps = self.src_fps / self.stride
        self.max_frames = int(max_frames)

    @property
    def expected_frames(self):
        """Best-effort count of frames this reader will emit."""
        if self.src_count > 0:
            n = (self.src_count + self.stride - 1) // self.stride
        else:
            n = 0
        if self.max_frames:
            return min(n, self.max_frames) if n else self.max_frames
        return n

    def frames(self):
        """Yield (index, frame) for every sampled, downscaled frame."""
        src_idx = 0
        emitted = 0
        size = (self.work_width, self.work_height)
        try:
            while True:
                ok, frame = self.cap.read()
                if not ok:
                    break
                if src_idx % self.stride == 0:
                    small = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
                    yield emitted, small
                    emitted += 1
                    if self.max_frames and emitted >= self.max_frames:
                        break
                src_idx += 1
        finally:
            self.cap.release()
