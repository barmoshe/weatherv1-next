import { NextRequest, NextResponse } from "next/server";
import { getAssetSource } from "@/server/assets/source";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { catalogStoreStatus } from "@/server/catalog/storage";
import { resolveWhisperBinary } from "@/server/whisper/binary";
import { pickActiveModel, listInstalledModels } from "@/server/whisper/models";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

function pickActiveLlm(): "anthropic" | "openai" | null {
  const pref = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const haveAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const haveOpenAi = Boolean(process.env.OPENAI_API_KEY);
  if (pref === "anthropic") return haveAnthropic ? "anthropic" : null;
  if (pref === "openai") return haveOpenAi ? "openai" : null;
  if (haveAnthropic) return "anthropic";
  if (haveOpenAi) return "openai";
  return null;
}

function pickActiveLlmModel(): string | null {
  const active = pickActiveLlm();
  if (active === "anthropic") return process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  if (active === "openai") return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  return null;
}

function pickActiveTranscription(
  localReady: boolean,
): "local-whispercpp" | "openai-cloud" | null {
  const pref = process.env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  if (pref === "local-whispercpp") return localReady ? "local-whispercpp" : null;
  if (pref === "openai-cloud") return process.env.OPENAI_API_KEY ? "openai-cloud" : null;
  if (localReady) return "local-whispercpp";
  if (process.env.OPENAI_API_KEY) return "openai-cloud";
  return null;
}

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const config = getRuntimeConfig();
  const runtime = getRuntimePaths();
  const workspace = getAssetSource().validateWorkspace();

  const whisperBinary = resolveWhisperBinary();
  const activeModel = pickActiveModel();
  const installedModels = listInstalledModels()
    .filter((m) => m.installed)
    .map((m) => m.id);

  return NextResponse.json({
    success: true,
    desktop_mode: config.desktopMode,
    workspace,
    runtime: {
      runtime_dir: runtime.runtimeDir,
      uploads_dir: runtime.uploadsDir,
      outputs_dir: runtime.outputsDir,
      cache_dir: runtime.cacheDir,
    },
    keys: {
      openai_configured: Boolean(process.env.OPENAI_API_KEY),
      anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY),
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
    },
    providers: {
      llm_pref: process.env.LLM_PROVIDER ?? "auto",
      transcription_pref: process.env.TRANSCRIPTION_PROVIDER ?? "auto",
      llm_active: pickActiveLlm(),
      llm_model: pickActiveLlmModel(),
      transcription_active: pickActiveTranscription(Boolean(whisperBinary && activeModel)),
    },
    whisper: {
      binary_ready: Boolean(whisperBinary),
      binary_path: whisperBinary?.path ?? null,
      binary_source: whisperBinary?.source ?? null,
      active_model: activeModel?.id ?? null,
      installed_models: installedModels,
      local_ready: Boolean(whisperBinary && activeModel),
    },
    ffmpeg: {
      ffmpeg_path: config.ffmpegPath ?? null,
      ffprobe_path: config.ffprobePath ?? null,
      bg_music_path: config.bgMusicPath,
    },
    catalog_store: catalogStoreStatus(),
  });
}
