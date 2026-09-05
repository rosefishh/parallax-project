import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Live selfie capture for face-match verification. Uses the device webcam via
// getUserMedia when available, with a file-upload fallback so the feature works
// even where camera access is blocked (headless/dev/incognito).

export function SelfieCapture({
  selfie,
  onCapture,
}: {
  selfie: File | null;
  onCapture: (file: File | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (selfie) {
      setPreview(URL.createObjectURL(selfie));
    } else {
      setPreview(null);
    }
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfie]);

  const startCamera = async () => {
    setCameraError(null);
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setLive(true);
    } catch (e) {
      setCameraError(
        "Camera unavailable. You can still upload a selfie photo below to run face-match.",
      );
    } finally {
      setBusy(false);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    // Hold until the camera has painted at least one actual frame.
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError("Camera frame not ready yet — please wait a moment and try Capture again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        onCapture(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
        stopCamera();
      }
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="mt-5 rounded-xl border border-border bg-accent/30 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Live Selfie</p>
        <span className="text-xs text-muted-foreground">सेल्फी</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Capture a live selfie to compare against the document portrait.
      </p>

      {cameraError && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
          {cameraError}
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          className={cn("aspect-[4/3] w-full object-cover", live ? "block" : "hidden")}
          autoPlay
          muted
          playsInline
        />
        {preview && !live && (
          <img
            src={preview}
            alt="Captured selfie preview"
            className="aspect-[4/3] w-full object-cover"
          />
        )}
        <div
          className={cn(
            "flex aspect-[4/3] flex-col items-center justify-center gap-2 text-white/70",
            live || preview ? "hidden" : "flex",
          )}
        >
          <Camera className="size-8" />
          <span className="text-xs">Camera preview off</span>
        </div>
      </div>

      {preview && !live && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-success">
          <Camera className="size-3.5" /> Selfie captured — {selfie?.name}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!live ? (
          <button
            type="button"
            onClick={startCamera}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Camera className="size-3.5" /> {busy ? "Starting..." : "Open Camera"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={captureFrame}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Camera className="size-3.5" /> Capture
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <X className="size-3.5" /> Cancel
            </button>
          </>
        )}
        {!live && (
          <button
            type="button"
            onClick={() => selfie && onCapture(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="size-3.5" /> Retake
          </button>
        )}
      </div>

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent">
        <UploadCloud className="size-4" />
        {selfie ? selfie.name : "Or upload a selfie photo instead"}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          className="hidden"
          disabled={live}
          onChange={(e) => onCapture(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}