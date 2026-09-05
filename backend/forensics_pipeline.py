"""
Unified forensic pipeline for the Node gateway.

Single subprocess invocation returning OCR fields, AI-generation detection,
tampering detection, and (optional) face matching as one JSON payload.

Usage:
    python forensics_pipeline.py --document <image_path> [--selfie <image_path>]
"""

import argparse
import json
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
MODEL_PATH = os.path.join(BASE_DIR, "python_api", "models", "face_detection_yunet_2023mar.onnx")

PASSPORT_RE = re.compile(r"[A-Z]{2}[0-9]{7}")
DATE_RE = re.compile(r"\b\d{2}[/\.-]\d{2}[/\.-]\d{4}\b")
# Machine Readable Zone (MRZ) detail line: ...<6IND9001155M3112317<<...
# Layout (line 2): <DOCNO><check><NAT3><DOB6><check><SEX1><EXP6><check>...
# so DOB (YYMMDD) is 6 digits after the 3-letter nationality, followed by a
# check digit, the single sex char, then EXP (YYMMDD) and a check digit.
MRZ_RECORD_RE = re.compile(r"([A-Z]{3})(\d{6})\d([MFX])(\d{6})\d")
MRZ_GENDER_RE = re.compile(r"\d{6}[MFX]")
def normalize_date(value):
    """Return an unambiguous YYYY-MM-DD string from DD-MM-YYYY or YYMMDD input."""
    if not value:
        return None
    value = value.strip()
    if len(value) == 6 and value.isdigit():
        # MRZ compact YYMMDD
        yy, mm, dd = value[:2], value[2:4], value[4:6]
        year = 2000 + int(yy) if int(yy) <= 49 else 1900 + int(yy)
        try:
            import datetime
            return datetime.date(year, int(mm), int(dd)).isoformat()
        except (ValueError, TypeError):
            return None
    parts = re.split(r"[/\.-]", value)
    if len(parts) == 3 and len(parts[2]) == 4:
        dd, mm, yyyy = parts
        try:
            import datetime
            return datetime.date(int(yyyy), int(mm), int(dd)).isoformat()
        except (ValueError, TypeError):
            return None
    return value


def load_env():
    """Load backend/.env so TESSERACT_CMD etc. resolve regardless of cwd.

    Prefers python-dotenv when installed, otherwise falls back to a tiny
    hand-rolled parser so the pipeline never depends on dotenv being present.
    """
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH, override=False)
    except ImportError:
        try:
            with open(ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except OSError:
            pass


def _configure_tesseract():
    """Point pytesseract at a real tesseract binary, with sane defaults."""
    import os as _os
    candidates = []
    env_cmd = _os.environ.get("TESSERACT_CMD")
    if env_cmd:
        candidates.append(env_cmd)
    # Common Windows install locations when TESSERACT_CMD is unset.
    candidates.extend([
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        r"C:\Tesseract-OCR\tesseract.exe",
    ])
    for c in candidates:
        if c and _os.path.exists(c):
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = c
            return True
    return False


def parse_passport_text(raw_text):
    """Extracts structured passport fields from raw OCR text via regex.

    Prefers the Machine Readable Zone (MRZ) for dates/gender when present,
    falling back to the label-prefixed plain text otherwise.
    """
    fields = {}

    # Document number: the familiar 2-letter + 7-digit passport number.
    m = PASSPORT_RE.search(raw_text)
    if m:
        fields["DocumentNumber"] = {"value": m.group(0)}

    # Dates: try MRZ compact YYMMDD first (fixed, reliable field ordering).
    # Strip whitespace so OCR spacing inside the MRZ detail line doesn't break
    # fixed-position extraction.
    compact = re.sub(r"\s+", "", raw_text)
    mrz = MRZ_RECORD_RE.search(compact)
    dob = None
    exp = None
    if mrz:
        _nat, dob, _g, exp, _ = mrz.groups()
    else:
        plain_dates = DATE_RE.findall(raw_text)
        if len(plain_dates) >= 2:
            dob, exp = plain_dates[0], plain_dates[1]
        elif len(plain_dates) == 1:
            dob = plain_dates[0]

    if dob:
        fields["DateOfBirth"] = {"value": normalize_date(dob)}
    if exp:
        fields["DateOfExpiration"] = {"value": normalize_date(exp)}

    # Gender: single M/F/X from the MRZ sex field.
    g = MRZ_GENDER_RE.search(compact)
    if g:
        fields["Gender"] = {"value": g.group(0)[-1]}

    if "IND" in raw_text or "INDIA" in raw_text:
        fields["CountryRegion"] = {"value": "IND"}
    return fields


def run_ocr(image_path):
    """Tesseract OCR with graceful fallback when tesseract/pytesseract is unavailable."""
    try:
        import cv2
        import numpy as np
        import pytesseract

        _configure_tesseract()

        img = cv2.imread(image_path)
        if img is None:
            return {"ok": False, "raw_text": "", "fields": {}, "error": "IMAGE_DECODE_FAILED"}

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        processed = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        raw_text = pytesseract.image_to_string(processed)

        return {
            "ok": True,
            "raw_text": raw_text.strip(),
            "fields": parse_passport_text(raw_text),
        }
    except Exception as exc:
        return {"ok": False, "raw_text": "", "fields": {}, "error": str(exc)}


def _annotate_colored(image, boxes, labels, color):
    """Draw overlays on a BGR image. boxes is a list of (x, y, w, h)."""
    import cv2
    for (x, y, w, h), label in zip(boxes, labels):
        x, y, w, h = int(x), int(y), int(w), int(h)
        cv2.rectangle(image, (x, y), (x + w, y + h), color, 3)
        ty = max(y - 10, 10)
        txt_w = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)[0][0]
        cv2.rectangle(image, (x, ty - 18), (x + txt_w + 6, ty + 2), color, -1)
        cv2.putText(image, label, (x + 3, ty), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, (255, 255, 255), 2, cv2.LINE_AA)


def _annotated_output_path(image_path):
    root, ext = os.path.splitext(image_path)
    if not ext:
        ext = ".jpg"
    return f"{root}_annotated{ext}"


def run_ai_detection(image_path, img_color=None):
    """FFT spectral + texture regularity analysis for AI-generated imagery."""
    ai_regions = []
    try:
        import cv2
        import numpy as np

        image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if image is None:
            return {"aiScore": 0, "isAiGenerated": False, "flags": ["IMAGE_READ_ERROR"]}

        ai_score = 0
        flags = []

        f = np.fft.fft2(image)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)

        h, w = image.shape
        center_h, center_w = h // 2, w // 2
        radius = min(h, w) // 8

        y, x = np.ogrid[:h, :w]
        mask = (x - center_w) ** 2 + (y - center_h) ** 2 > radius ** 2
        high_freq_power = np.mean(magnitude_spectrum[mask])

        if high_freq_power > 250 or high_freq_power < 55:
            ai_score += 45
            flags.append("SYNTHETIC_FREQUENCY_SPECTRUM_ANOMALY")
            # Highlight the high-frequency (outer) ring region presumed synthetic.
            ai_regions.append((w // 2 - radius, h // 2 - radius, 2 * radius, 2 * radius))

        laplacian_var = cv2.Laplacian(image, cv2.CV_64F).var()
        if laplacian_var < 30.0:
            ai_score += 35
            flags.append("UNNATURAL_SMOOTHNESS_NO_SENSOR_NOISE")

        # Draw AI anomaly overlay if a color canvas was supplied.
        if img_color is not None and ai_regions:
            _annotate_colored(img_color, ai_regions,
                              ["AI SPECTRAL ANOMALY"] * len(ai_regions), (255, 0, 255))

        return {
            "aiScore": ai_score,
            "isAiGenerated": ai_score >= 40,
            "flags": flags,
            "regions": ai_regions,
        }
    except Exception as exc:
        return {"aiScore": 0, "isAiGenerated": False, "flags": [f"AI_DETECTOR_ERROR: {str(exc)}"], "regions": []}


def run_tamper_detection(image_path, img_color=None):
    """Edge-discontinuity + blur/smoothing analysis for tampered documents."""
    tamper_boxes = []
    banner_flags = []
    try:
        import cv2

        if not os.path.exists(image_path):
            return {"tamperScore": 0, "isTampered": False, "flags": ["FILE_NOT_FOUND"]}

        img_gray = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if img_gray is None:
            return {"tamperScore": 0, "isTampered": False, "flags": ["INVALID_IMAGE_FILE"]}

        tamper_score = 0
        flags = []

        # Edge-discontinuity / photo-cut heuristic. A large rectangular contour
        # is usually just the document frame against the background, not proof
        # of a cut — the old heuristic wrongly flagged nearly every valid
        # scanned document. A genuine pasted/edited region shows up as a large
        # interior contour AND a smoothing/no-seam artifact, so we only suspect
        # a cut when BOTH signals are present.
        laplacian_var = cv2.Laplacian(img_gray, cv2.CV_64F).var()
        smoothing_present = laplacian_var < 30.0

        img_h, img_w = img_gray.shape[:2]
        frame_area = img_h * img_w
        edges = cv2.Canny(img_gray, 100, 200)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            area = w * h
            # Must be large AND fully interior (a pasted region sits inside the
            # outer frame) AND show smoothing/noise-deficiency — never just an
            # ordinary document outline.
            border_inset = 12
            interior = (x >= border_inset and y >= border_inset
                        and x + w <= img_w - border_inset and y + h <= img_h - border_inset)
            if area >= frame_area * 0.25 and interior and smoothing_present:
                tamper_score += 40
                flags.append("HIGH_EDGE_DISCONTINUITY_POSSIBLE_PHOTO_CUT")
                tamper_boxes.append((x, y, w, h))
                if tamper_score >= 40:
                    break

        # Over-processed / smoothed-out scans remain a (now softened) signal,
        # raised from the old 50.0 so clean photographs no longer false-positive.
        if laplacian_var < 30.0:
            tamper_score += 30
            flags.append("BLURRY_TEXT_OR_UNNATURAL_SMOOTHING")
            banner_flags.append("UNNATURAL SMOOTHING / BLUR DETECTED")

        # Draw tamper overlays if a color canvas was supplied.
        if img_color is not None:
            if tamper_boxes:
                _annotate_colored(img_color, tamper_boxes,
                                  ["POSSIBLE PHOTO CUT"] * len(tamper_boxes), (0, 0, 255))
            for idx, banner in enumerate(banner_flags):
                cv2.putText(img_color, f"WARNING: {banner}", (20, 60 * (idx + 1)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        return {
            "tamperScore": tamper_score,
            "isTampered": tamper_score >= 30,
            "flags": flags,
            "regions": tamper_boxes,
        }
    except Exception as exc:
        return {"tamperScore": 0, "isTampered": False, "flags": [f"TAMPER_DETECTOR_ERROR: {str(exc)}"], "regions": []}


def run_face_match(doc_path, selfie_path, img_color=None):
    """YuNet DNN face detection + multi-channel histogram comparison."""
    face_box = []
    if not selfie_path:
        return {
            "face_score": 100.0,
            "matched": True,
            "skipped": True,
            "details": "Selfie omitted from validation request",
        }
    try:
        import cv2
        import numpy as np

        if not os.path.exists(MODEL_PATH):
            return {"face_score": 50.0, "matched": False, "skipped": False, "error": "FACE_MODEL_MISSING"}

        doc_img = cv2.imread(doc_path)
        selfie_img = cv2.imread(selfie_path)
        if doc_img is None or selfie_img is None:
            return {"face_score": 40.0, "matched": False, "skipped": False, "details": "Could not decode one or both images"}

        detector = cv2.FaceDetectorYN.create(
            MODEL_PATH, "", (0, 0),
            score_threshold=0.7, nms_threshold=0.3, top_k=5000,
        )

        def detect_boxes(img):
            h, w = img.shape[:2]
            detector.setInputSize((w, h))
            _, faces = detector.detect(img)
            if faces is None or len(faces) == 0:
                return []
            ordered = sorted(faces, key=lambda f: float(f[14]), reverse=True)
            return [(int(b[0]), int(b[1]), int(b[2]), int(b[3])) for b in ordered]

        doc_faces = detect_boxes(doc_img)
        selfie_faces = detect_boxes(selfie_img)

        if len(doc_faces) == 0 or len(selfie_faces) == 0:
            return {"face_score": 40.0, "matched": False, "skipped": False, "details": "Could not detect clear face region in one or both images"}

        (x1, y1, w1, h1) = doc_faces[0]
        (x2, y2, w2, h2) = selfie_faces[0]
        face_box = [x1, y1, w1, h1]

        crop1 = cv2.resize(doc_img[y1:y1 + h1, x1:x1 + w1], (100, 100))
        crop2 = cv2.resize(selfie_img[y2:y2 + h2, x2:x2 + w2], (100, 100))

        correlations = []
        for channel in range(3):
            hist1 = cv2.calcHist([crop1], [channel], None, [256], [0, 256])
            hist2 = cv2.calcHist([crop2], [channel], None, [256], [0, 256])
            cv2.normalize(hist1, hist1)
            cv2.normalize(hist2, hist2)
            correlations.append(cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL))

        match_score = round(max(0.0, sum(correlations) / len(correlations)) * 100.0, 2)

        # Draw the matched face region if a color canvas was supplied.
        if img_color is not None and face_box:
            _annotate_colored(img_color, [face_box],
                              [f"FACE MATCH {match_score:.0f}%"], (0, 255, 0))

        return {
            "face_score": match_score,
            "matched": match_score >= 65.0,
            "skipped": False,
            "details": f"Biometric similarity confidence: {match_score}%",
            "region": face_box,
        }
    except Exception as exc:
        return {"face_score": 50.0, "matched": False, "skipped": False, "error": str(exc)}


def save_annotated_image(image_path, tamper_result, ai_result, face_result):
    """Overlay all detected regions on a color copy and persist *_annotated.<ext>."""
    try:
        import cv2
        color = cv2.imread(image_path)
        if color is None:
            return None

        # AI anomaly ring is a large box; draw it first so later boxes layer above.
        if ai_result.get("regions"):
            _annotate_colored(color, ai_result["regions"],
                              ["AI SPECTRAL ANOMALY"] * len(ai_result["regions"]), (255, 0, 255))
        if tamper_result.get("regions"):
            _annotate_colored(color, tamper_result["regions"],
                              ["POSSIBLE PHOTO CUT"] * len(tamper_result["regions"]), (0, 0, 255))
        else:
            for f in (tamper_result.get("flags") or []):
                if f == "BLURRY_TEXT_OR_UNNATURAL_SMOOTHING":
                    cv2.putText(color, "WARNING: UNNATURAL SMOOTHING DETECTED", (20, 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        if face_result.get("region"):
            _annotate_colored(color, [face_result["region"]],
                              [f"FACE MATCH {face_result.get('face_score', 0):.0f}%"], (0, 255, 0))

        out_path = _annotated_output_path(image_path)
        cv2.imwrite(out_path, color)
        return out_path
    except Exception as exc:
        print(f"WARN: annotation save failed: {exc}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Passport forensic pipeline")
    parser.add_argument("--document", required=True, help="Path to document image")
    parser.add_argument("--selfie", default=None, help="Optional path to selfie image")
    parser.add_argument("--no-annotate", action="store_true",
                        help="Skip generating the annotated evidence image")
    args = parser.parse_args()

    load_env()

    tamper_result = run_tamper_detection(args.document)
    ai_result = run_ai_detection(args.document)
    face_result = run_face_match(args.document, args.selfie)

    annotated_path = None
    if not args.no_annotate:
        annotated_path = save_annotated_image(
            args.document, tamper_result, ai_result, face_result)

    result = {
        "document": args.document,
        "ocr": run_ocr(args.document),
        "ai": ai_result,
        "tamper": tamper_result,
        "face": face_result,
        "annotatedImagePath": annotated_path,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)