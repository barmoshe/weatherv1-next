"""Forced alignment: put every plan time on the real voice. Usage: align.py <job-dir>

Whisper's word starts run early (0.1-0.15 s on most words, 0.3-0.5 s after a pause, sometimes more),
which reads as graphics drifting off the voice. This aligns each word of transcript.fixed.json to the
recording with a Hebrew wav2vec2 CTC model, stores the aligned start/end on every word (the Whisper
time is kept as `whisper_start`), and remaps every time in plan.json through a monotone
Whisper->aligned map. The audio is never touched. Safe to re-run: it always maps from the Whisper
clock (plan.whisper.json is written once and is the source from then on).
Ported from bar_builds experiments/2026-10-04-claude-forecast-11-5/src/align.py.
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import torch
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL = "imvladikon/wav2vec2-xls-r-300m-hebrew"
ONES = ["", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"]
TEENS = ["עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה", "שש עשרה", "שבע עשרה", "שמונה עשרה", "תשע עשרה"]
TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]
THOUSANDS = {1: "אלף", 2: "אלפיים", 3: "שלושת אלפים", 4: "ארבעת אלפים", 5: "חמשת אלפים", 6: "ששת אלפים",
             7: "שבעת אלפים", 8: "שמונת אלפים", 9: "תשעת אלפים", 10: "עשרת אלפים"}


def spell(n: int) -> str:
    """Hebrew number as spoken in a forecast (feminine forms, as in 'שלוש מעלות')."""
    if n == 0:
        return "אפס"
    parts = []
    if n >= 1000:
        parts.append(THOUSANDS.get(n // 1000, f"{spell(n // 1000)} אלף"))
        n %= 1000
    if n >= 100:
        parts.append({1: "מאה", 2: "מאתיים"}.get(n // 100, f"{ONES[n // 100]} מאות"))
        n %= 100
    if 10 <= n < 20:
        parts.append(TEENS[n - 10])
    elif n:
        t, o = divmod(n, 10)
        parts.append(" ו".join(x for x in [TENS[t], ONES[o]] if x))
    return " ו".join(parts) if len(parts) > 1 else parts[0]


def spoken(word: str) -> str:
    """Digits to words, keeping a Hebrew prefix letter (ו-18 -> ושמונה עשרה, ל-8,000 -> לשמונת אלפים)."""
    def rep(m):
        return spell(int(m.group(0).replace(",", "")))
    w = re.sub(r"(?<=[֐-׿])-(?=\d)", "", word)
    return re.sub(r"\d[\d,]*", rep, w)


def load(path, sr=16000):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def main(job):
    narration = next(os.path.join(job, f) for f in os.listdir(job) if re.match(r"^narration\.(mp3|m4a|wav|ogg|opus|aac)$", f, re.I))
    fixed_path, plan_path, plan_src = (os.path.join(job, f) for f in ("transcript.fixed.json", "plan.json", "plan.whisper.json"))
    tr = json.load(open(fixed_path))
    words = tr["words"]
    for w in words:  # always align from Whisper's clock
        w.setdefault("whisper_start", w["start"])
        w.setdefault("whisper_end", w["end"])

    proc = Wav2Vec2Processor.from_pretrained(MODEL)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL).eval()
    vocab = proc.tokenizer.get_vocab()
    blank = vocab["[PAD]"]
    x = load(narration)
    with torch.inference_mode():
        lp = torch.log_softmax(model(proc(x, sampling_rate=16000, return_tensors="pt").input_values).logits, dim=-1)
    spf = len(x) / 16000 / lp.shape[1]

    letters = [[c for c in spoken(w["w"]) if c in vocab and c != "|"] for w in words]
    tokens = [vocab[c] for L in letters for c in L]
    ali, _ = torchaudio.functional.forced_align(lp, torch.tensor([tokens], dtype=torch.int32), blank=blank)
    first, k, prev = [], 0, blank
    for f, a in enumerate(ali[0].tolist()):
        if a != blank and (a != prev or prev == blank) and k < len(tokens):
            first.append(f)
            k += 1
        prev = a

    i, moved = 0, []
    for w, L in zip(words, letters):
        if not L:
            continue
        s, e = first[i], first[i + len(L) - 1]
        i += len(L)
        w["start"], w["end"] = round(s * spf, 2), round((e + 1) * spf, 2)
        moved.append(w["start"] - w["whisper_start"])
    tr["aligned"] = MODEL
    json.dump(tr, open(fixed_path, "w"), ensure_ascii=False, indent=1)

    # Monotone Whisper -> aligned map, applied to every time in the plan up to the end of the voice.
    pairs = sorted({(w["whisper_start"], w["start"]) for w in words})
    xs, ys = np.array([p[0] for p in pairs]), np.array([p[1] for p in pairs])
    keep = np.concatenate([[True], np.diff(ys) > 0])
    xs, ys = xs[keep], ys[keep]
    voice_end = len(x) / 16000
    if not os.path.exists(plan_src):
        json.dump(json.load(open(plan_path)), open(plan_src, "w"), ensure_ascii=False, indent=1)
    plan = json.load(open(plan_src))
    n = 0

    def f(t):
        nonlocal n
        if t <= 0 or t >= voice_end - 0.01:
            return t
        v = round(float(np.interp(t, xs, ys)), 2)
        n += abs(v - t) >= 0.01
        return v

    def walk(o):
        if isinstance(o, list):
            return [walk(v) for v in o]
        if isinstance(o, dict):
            return {k: (f(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and (k in ("start", "end", "at") or k.endswith("_at")) else walk(v))
                    for k, v in o.items()}
        return o

    plan["scenes"] = walk(plan["scenes"])
    plan["captions"] = walk(plan["captions"])
    for c in plan["captions"]:  # caption ends: keep them on the aligned word ends where they were
        c["end"] = max(c["end"], c["start"] + 0.3)
    json.dump(plan, open(plan_path, "w"), ensure_ascii=False, indent=1)
    d = np.array(moved)
    print(f"aligned {len(moved)} words: Whisper was early by {-np.median(d):.2f} s (median), max {-d.min():.2f} s; plan values moved: {n}")


if __name__ == "__main__":
    main(sys.argv[1])
