import { useCallback, useEffect, useState } from "react";
import {
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { storageService } from "../services/storage";
import {
  AMBIENT_SOUNDSCAPES,
  ambientAudio,
  type ActiveAmbientTexture,
  type AmbientTexture,
} from "../services/ambientAudio";
import type { MediaSessionState, MusicPlayerPreference } from "../types/athenaeum";

interface MusicPlayerProps {
  preferredMusicPlayer?: MusicPlayerPreference;
  onOpenFocusStudio?: () => void;
}

function formatSourceLabel(appId: string): string {
  const lower = appId.toLowerCase();
  if (lower.includes("applemusic") || lower.includes("appleinc") || lower.includes("itunes")) {
    return "Apple Music";
  }
  if (lower.includes("spotify")) return "Spotify";
  if (!appId) return "Windows Media";
  const cleaned = appId.split("!").pop() || appId;
  return cleaned.replace(/\.exe$/i, "");
}

export function MusicPlayer({
  preferredMusicPlayer = "none",
  onOpenFocusStudio,
}: MusicPlayerProps) {
  const [media, setMedia] = useState<MediaSessionState>({
    active: false,
    title: "",
    artist: "",
    album: "",
    sourceApp: "",
    isPlaying: false,
    isShuffle: false,
    repeatMode: "none",
    positionSeconds: 0,
    durationSeconds: 0,
  });

  const [ambientTexture, setAmbientTexture] = useState<AmbientTexture>(() =>
    ambientAudio.getTexture()
  );
  const [ambientVolume, setAmbientVolume] = useState<number>(() =>
    ambientAudio.getVolume()
  );

  useEffect(() => {
    return ambientAudio.subscribe(() => {
      setAmbientTexture(ambientAudio.getTexture());
      setAmbientVolume(ambientAudio.getVolume());
    });
  }, []);

  const pollMedia = useCallback(async () => {
    const state = await storageService.getMediaState();
    setMedia(state);
  }, []);

  useEffect(() => {
    void pollMedia();
    const pollId = window.setInterval(() => {
      void pollMedia();
    }, 2500);
    return () => window.clearInterval(pollId);
  }, [pollMedia]);

  useEffect(() => {
    if (!media.active || !media.isPlaying || media.durationSeconds <= 0) return;
    const tickId = window.setInterval(() => {
      setMedia((prev) => {
        if (!prev.active || !prev.isPlaying) return prev;
        return {
          ...prev,
          positionSeconds: Math.min(prev.durationSeconds, prev.positionSeconds + 1),
        };
      });
    }, 1000);
    return () => window.clearInterval(tickId);
  }, [media.active, media.isPlaying, media.durationSeconds]);

  const handleToggleTexture = (target: ActiveAmbientTexture) => {
    ambientAudio.setVolume(ambientVolume);
    const next = ambientAudio.toggleTexture(target);
    setAmbientTexture(next);
  };

  const handleVolumeChange = (nextVol: number) => {
    setAmbientVolume(nextVol);
    ambientAudio.setVolume(nextVol);
  };

  const handleAction = async (
    action: "previous" | "play_pause" | "next" | "toggle_shuffle" | "cycle_repeat"
  ) => {
    await storageService.sendMediaControl(action);
    window.setTimeout(() => void pollMedia(), 350);
  };

  const progressPercent =
    media.durationSeconds > 0
      ? Math.min(100, (media.positionSeconds / media.durationSeconds) * 100)
      : 0;

  return (
    <div
      className="smoked-glass relative flex w-[320px] flex-col items-center rounded-[6px] px-4 py-3 text-center select-none"
      data-testid="cardless-music-player"
    >
      {/* Strictly cardless: Windows SMTC / Apple Music session */}
      {media.active ? (
        <>
          <div className="flex items-center gap-2">
            <span className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-luminous)]/80">
              {formatSourceLabel(media.sourceApp)}
            </span>
            {onOpenFocusStudio && (
              <button
                type="button"
                onClick={onOpenFocusStudio}
                data-testid="open-focus-studio-btn"
                title="Open Focus & Atmosphere Studio"
                aria-label="Open Focus & Atmosphere Studio"
                className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-brass)] transition-colors"
              >
                <SlidersHorizontal className="h-3 w-3" strokeWidth={1.6} />
              </button>
            )}
          </div>
          <div className="mt-0.5 font-editorial text-[1.08rem] leading-tight tracking-[0.02em] text-[var(--text-ivory)] truncate max-w-full">
            {media.title || "Playing"}
          </div>
          <div className="mt-0.5 font-ui text-[0.68rem] tracking-[0.08em] text-[var(--text-muted)] truncate max-w-full">
            {media.artist || media.album || "Active Session"}
          </div>

          <div className="mt-2.5 h-[1.5px] w-full bg-[rgba(237,234,224,0.16)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent-luminous)] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-2 flex items-center gap-3.5 text-[var(--text-ivory-soft)]">
            <button
              type="button"
              onClick={() => void handleAction("toggle_shuffle")}
              aria-label="Toggle shuffle"
              className={`cursor-pointer bg-transparent border-0 p-0.5 transition-colors ${
                media.isShuffle
                  ? "text-[var(--accent-brass)]"
                  : "text-[var(--text-muted)]/75 hover:text-[var(--text-ivory)]"
              }`}
            >
              <Shuffle className="h-3 w-3" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => void handleAction("previous")}
              aria-label="Previous track"
              className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] transition-colors"
            >
              <SkipBack className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => void handleAction("play_pause")}
              aria-label={media.isPlaying ? "Pause audio" : "Play audio"}
              className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-ivory)] hover:text-[var(--accent-luminous)] transition-colors"
            >
              {media.isPlaying ? (
                <Pause className="h-4 w-4" strokeWidth={1.6} />
              ) : (
                <Play className="h-4 w-4" strokeWidth={1.6} />
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleAction("next")}
              aria-label="Next track"
              className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => void handleAction("cycle_repeat")}
              aria-label="Cycle repeat mode"
              className={`cursor-pointer bg-transparent border-0 p-0.5 transition-colors ${
                media.repeatMode !== "none"
                  ? "text-[var(--accent-brass)]"
                  : "text-[var(--text-muted)]/75 hover:text-[var(--text-ivory)]"
              }`}
            >
              {media.repeatMode === "track" ? (
                <Repeat1 className="h-3 w-3" strokeWidth={1.6} />
              ) : (
                <Repeat className="h-3 w-3" strokeWidth={1.6} />
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="relative flex w-full items-center justify-center">
            <span
              data-testid="no-media-active-label"
              className="font-editorial text-[1.06rem] tracking-[0.03em] text-[var(--text-ivory)] text-center"
              style={{ textShadow: "0 2px 12px rgba(4, 9, 18, 0.72)" }}
            >
              No Media Active
            </span>
            {onOpenFocusStudio && (
              <button
                type="button"
                onClick={onOpenFocusStudio}
                data-testid="open-focus-studio-btn"
                title="Open Focus & Atmosphere Studio"
                aria-label="Open Focus & Atmosphere Studio"
                className="absolute right-0 cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-brass)] transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.6} />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-center gap-3">
            {preferredMusicPlayer !== "none" && (
              <>
                <button
                  type="button"
                  onClick={() => void storageService.launchMusicPlayer(preferredMusicPlayer)}
                  data-testid="launch-music-player-btn"
                  className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1.5 font-ui text-[0.65rem] uppercase tracking-[0.16em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)] transition-colors"
                  style={{ textShadow: "0 2px 10px rgba(4, 9, 18, 0.78)" }}
                >
                  <Music className="h-3 w-3" strokeWidth={1.6} />
                  {preferredMusicPlayer === "spotify" ? "Open Spotify" : "Open Apple Music"}
                </button>
                <span className="text-[var(--text-muted)]/45">·</span>
              </>
            )}
            <button
              type="button"
              onClick={() => void handleAction("play_pause")}
              aria-label="Resume media"
              className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] transition-colors"
              title="Play or resume Windows media"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
          </div>
        </>
      )}

      {/* Built-In Web Audio Ambient Soundscape Mixer in a balanced 3x2 Grid */}
      <div
        className="mt-3 flex flex-col items-stretch gap-2.5 w-full border-t border-[rgba(226,180,109,0.14)] pt-2.5"
        data-testid="ambient-soundscape-mixer"
      >
        <div
          className="grid grid-cols-3 gap-1.5 w-full"
          data-testid="ambient-soundscape-grid"
        >
          {AMBIENT_SOUNDSCAPES.map((t) => {
            const active = ambientTexture === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleToggleTexture(t.id)}
                data-testid={`ambient-texture-${t.id}`}
                aria-pressed={active}
                title={active ? `Turn off ${t.label}` : `Play ${t.label}`}
                className={`cursor-pointer rounded-[3px] border px-1.5 py-1 text-center font-ui text-[0.58rem] font-medium uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.18)] text-[#F3EFE6]"
                    : "border-[rgba(226,180,109,0.14)] bg-[rgba(10,14,20,0.42)] text-[#B8C6D6] hover:border-[rgba(226,180,109,0.34)] hover:text-[#F3EFE6]"
                }`}
              >
                {t.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Low-profile hairline volume slider */}
        <div className="flex items-center gap-2 w-full">
          <Volume2
            className={`h-3 w-3 shrink-0 transition-colors ${
              ambientTexture !== "off"
                ? "text-[var(--accent-luminous)]"
                : "text-[var(--text-muted)]/75"
            }`}
            strokeWidth={1.6}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(ambientVolume * 100)}
            onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
            aria-label="Ambient soundscape volume"
            data-testid="ambient-volume-slider"
            className="h-[2px] flex-1 cursor-pointer appearance-none rounded-full bg-[rgba(243,239,230,0.22)] accent-[#e2b46d]"
          />
          <span className="font-ui tabular-nums text-[0.6rem] text-[var(--text-muted)] w-7 text-right">
            {Math.round(ambientVolume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
