"""Local Whisper with word timestamps -> transcript.json. Usage: transcribe.py <audio> <out.json> [model]

Uses openai-whisper (models cache in ~/.cache/whisper). If the import fails on NumPy 2.x, run it from
a venv made with `python3 -m venv --system-site-packages venv && venv/bin/pip install "numpy<2"` and
point WEATHER_AGENT_PYTHON at venv/bin/python.
"""
import json
import sys

import whisper

# Kept in sync with WHISPER_HE_PROMPT in src/server/pipeline/transcript-fixes.ts (agent/tools/transcribe.ts passes it in).
audio, out, model_name, prompt = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
model = whisper.load_model(model_name)
r = model.transcribe(audio, language="he", word_timestamps=True, fp16=False, initial_prompt=prompt)
words = [
    {"w": w["word"].strip(), "start": round(w["start"], 2), "end": round(w["end"], 2)}
    for s in r["segments"] for w in s.get("words", []) if w["word"].strip()
]
json.dump({"model": model_name, "text": r["text"].strip(), "words": words,
           "segments": [{"start": s["start"], "end": s["end"], "text": s["text"].strip()} for s in r["segments"]]},
          open(out, "w"), ensure_ascii=False, indent=1)
print(f"{len(words)} words")
