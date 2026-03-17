import { Camera, Circle, Download, Loader2, Monitor, Play, RefreshCw, Square, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SandboxAgentError } from "sandbox-agent";
import type { DesktopRecordingInfo, DesktopStatusResponse, SandboxAgent } from "sandbox-agent";
import { DesktopViewer } from "@sandbox-agent/react";
import type { DesktopViewerClient } from "@sandbox-agent/react";
const MIN_SPIN_MS = 350;
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof SandboxAgentError && error.problem?.detail) return error.problem.detail;
  if (error instanceof Error) return error.message;
  return fallback;
};
const formatStartedAt = (value: string | null | undefined): string => {
  if (!value) return "Not started";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};
const formatDuration = (start: string, end?: string | null): string => {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "Unknown";
  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};
const createScreenshotUrl = async (bytes: Uint8Array): Promise<string> => {
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const blob = new Blob([payload.buffer], { type: "image/png" });
  if (typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(blob);
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read screenshot blob."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read screenshot blob."));
      }
    };
    reader.readAsDataURL(blob);
  });
};
const DesktopTab = ({ getClient }: { getClient: () => SandboxAgent }) => {
  const [status, setStatus] = useState<DesktopStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState("1440");
  const [height, setHeight] = useState("900");
  const [dpi, setDpi] = useState("96");
  // Screenshot fallback
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  // Live view
  const [liveViewActive, setLiveViewActive] = useState(false);
  const [liveViewError, setLiveViewError] = useState<string | null>(null);
  // Memoize the client as a DesktopViewerClient so the reference is stable
  // across renders and doesn't cause the DesktopViewer effect to re-fire.
  const viewerClient = useMemo<DesktopViewerClient>(() => {
    const c = getClient();
    return {
      startDesktopStream: () => c.startDesktopStream(),
      stopDesktopStream: () => c.stopDesktopStream(),
      connectDesktopStream: (opts?: Parameters<SandboxAgent["connectDesktopStream"]>[0]) => c.connectDesktopStream(opts),
    };
  }, [getClient]);
  // Recording
  const [recordings, setRecordings] = useState<DesktopRecordingInfo[]>([]);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingActing, setRecordingActing] = useState<"start" | "stop" | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingFps, setRecordingFps] = useState("30");
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [downloadingRecordingId, setDownloadingRecordingId] = useState<string | null>(null);
  // Active recording tracking
  const activeRecording = useMemo(() => recordings.find((r) => r.status === "recording"), [recordings]);
  const revokeScreenshotUrl = useCallback(() => {
    setScreenshotUrl((current) => {
      if (current?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, []);
  const loadStatus = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const next = await getClient().getDesktopStatus();
        setStatus(next);
        return next;
      } catch (loadError) {
        setError(extractErrorMessage(loadError, "Unable to load desktop status."));
        return null;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getClient],
  );
  const refreshScreenshot = useCallback(async () => {
    setScreenshotLoading(true);
    setScreenshotError(null);
    try {
      const bytes = await getClient().takeDesktopScreenshot();
      revokeScreenshotUrl();
      setScreenshotUrl(await createScreenshotUrl(bytes));
    } catch (captureError) {
      revokeScreenshotUrl();
      setScreenshotError(extractErrorMessage(captureError, "Unable to capture desktop screenshot."));
    } finally {
      setScreenshotLoading(false);
    }
  }, [getClient, revokeScreenshotUrl]);
  const loadRecordings = useCallback(async () => {
    setRecordingLoading(true);
    setRecordingError(null);
    try {
      const result = await getClient().listDesktopRecordings();
      setRecordings(result.recordings);
    } catch (loadError) {
      setRecordingError(extractErrorMessage(loadError, "Unable to load recordings."));
    } finally {
      setRecordingLoading(false);
    }
  }, [getClient]);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (status?.state === "active") {
      void loadRecordings();
    } else {
      revokeScreenshotUrl();
      setLiveViewActive(false);
    }
  }, [status?.state, loadRecordings, revokeScreenshotUrl]);
  useEffect(() => {
    return () => revokeScreenshotUrl();
  }, [revokeScreenshotUrl]);
  // Poll recording list while a recording is active
  useEffect(() => {
    if (!activeRecording) return;
    const interval = setInterval(() => void loadRecordings(), 3000);
    return () => clearInterval(interval);
  }, [activeRecording, loadRecordings]);
  const handleStart = async () => {
    const parsedWidth = Number.parseInt(width, 10);
    const parsedHeight = Number.parseInt(height, 10);
    const parsedDpi = Number.parseInt(dpi, 10);
    setActing("start");
    setError(null);
    const startedAt = Date.now();
    try {
      const next = await getClient().startDesktop({
        width: Number.isFinite(parsedWidth) ? parsedWidth : undefined,
        height: Number.isFinite(parsedHeight) ? parsedHeight : undefined,
        dpi: Number.isFinite(parsedDpi) ? parsedDpi : undefined,
      });
      setStatus(next);
    } catch (startError) {
      setError(extractErrorMessage(startError, "Unable to start desktop runtime."));
      await loadStatus("refresh");
    } finally {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < MIN_SPIN_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, MIN_SPIN_MS - elapsedMs));
      }
      setActing(null);
    }
  };
  const handleStop = async () => {
    setActing("stop");
    setError(null);
    const startedAt = Date.now();
    try {
      const next = await getClient().stopDesktop();
      setStatus(next);
      revokeScreenshotUrl();
      setLiveViewActive(false);
    } catch (stopError) {
      setError(extractErrorMessage(stopError, "Unable to stop desktop runtime."));
      await loadStatus("refresh");
    } finally {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < MIN_SPIN_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, MIN_SPIN_MS - elapsedMs));
      }
      setActing(null);
    }
  };
  const handleStartRecording = async () => {
    const fps = Number.parseInt(recordingFps, 10);
    setRecordingActing("start");
    setRecordingError(null);
    try {
      await getClient().startDesktopRecording({
        fps: Number.isFinite(fps) && fps > 0 ? fps : undefined,
      });
      await loadRecordings();
    } catch (err) {
      setRecordingError(extractErrorMessage(err, "Unable to start recording."));
    } finally {
      setRecordingActing(null);
    }
  };
  const handleStopRecording = async () => {
    setRecordingActing("stop");
    setRecordingError(null);
    try {
      await getClient().stopDesktopRecording();
      await loadRecordings();
    } catch (err) {
      setRecordingError(extractErrorMessage(err, "Unable to stop recording."));
    } finally {
      setRecordingActing(null);
    }
  };
  const handleDeleteRecording = async (id: string) => {
    setDeletingRecordingId(id);
    try {
      await getClient().deleteDesktopRecording(id);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setRecordingError(extractErrorMessage(err, "Unable to delete recording."));
    } finally {
      setDeletingRecordingId(null);
    }
  };
  const handleDownloadRecording = async (id: string, fileName: string) => {
    setDownloadingRecordingId(id);
    try {
      const bytes = await getClient().downloadDesktopRecording(id);
      const blob = new Blob([bytes], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setRecordingError(extractErrorMessage(err, "Unable to download recording."));
    } finally {
      setDownloadingRecordingId(null);
    }
  };
  const canRefreshScreenshot = status?.state === "active";
  const isActive = status?.state === "active";
  const resolutionLabel = useMemo(() => {
    const resolution = status?.resolution;
    if (!resolution) return "Unknown";
    const dpiLabel = resolution.dpi ? ` @ ${resolution.dpi} DPI` : "";
    return `${resolution.width} x ${resolution.height}${dpiLabel}`;
  }, [status?.resolution]);
  return (
    <div className="desktop-panel">
      <div className="inline-row" style={{ marginBottom: 16 }}>
        <button className="button secondary small" onClick={() => void loadStatus("refresh")} disabled={loading || refreshing}>
          <RefreshCw className={`button-icon ${loading || refreshing ? "spinner-icon" : ""}`} />
          Refresh Status
        </button>
        {isActive && !liveViewActive && (
          <button className="button secondary small" onClick={() => void refreshScreenshot()} disabled={!canRefreshScreenshot || screenshotLoading}>
            {screenshotLoading ? <Loader2 className="button-icon spinner-icon" /> : <Camera className="button-icon" />}
            Screenshot
          </button>
        )}
      </div>
      {error && <div className="banner error">{error}</div>}
      {screenshotError && <div className="banner error">{screenshotError}</div>}
      {/* ========== Runtime Section ========== */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <Monitor size={14} style={{ marginRight: 6 }} />
            Desktop Runtime
          </span>
          <span
            className={`pill ${
              status?.state === "active" ? "success" : status?.state === "install_required" ? "warning" : status?.state === "failed" ? "danger" : ""
            }`}
          >
            {status?.state ?? "unknown"}
          </span>
        </div>
        <div className="desktop-state-grid">
          <div>
            <div className="card-meta">Display</div>
            <div className="mono">{status?.display ?? "Not assigned"}</div>
          </div>
          <div>
            <div className="card-meta">Resolution</div>
            <div className="mono">{resolutionLabel}</div>
          </div>
          <div>
            <div className="card-meta">Started</div>
            <div>{formatStartedAt(status?.startedAt)}</div>
          </div>
        </div>
        <div className="desktop-start-controls">
          <div className="desktop-input-group">
            <label className="label">Width</label>
            <input className="setup-input mono" value={width} onChange={(event) => setWidth(event.target.value)} inputMode="numeric" />
          </div>
          <div className="desktop-input-group">
            <label className="label">Height</label>
            <input className="setup-input mono" value={height} onChange={(event) => setHeight(event.target.value)} inputMode="numeric" />
          </div>
          <div className="desktop-input-group">
            <label className="label">DPI</label>
            <input className="setup-input mono" value={dpi} onChange={(event) => setDpi(event.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="card-actions">
          {isActive ? (
            <button className="button danger small" onClick={() => void handleStop()} disabled={acting === "stop"}>
              {acting === "stop" ? <Loader2 className="button-icon spinner-icon" /> : <Square className="button-icon" />}
              Stop Desktop
            </button>
          ) : (
            <button className="button success small" onClick={() => void handleStart()} disabled={acting === "start"}>
              {acting === "start" ? <Loader2 className="button-icon spinner-icon" /> : <Play className="button-icon" />}
              Start Desktop
            </button>
          )}
        </div>
      </div>
      {/* ========== Missing Dependencies ========== */}
      {status?.missingDependencies && status.missingDependencies.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Missing Dependencies</span>
          </div>
          <div className="desktop-chip-list">
            {status.missingDependencies.map((dependency) => (
              <span key={dependency} className="pill warning">
                {dependency}
              </span>
            ))}
          </div>
          {status.installCommand && (
            <>
              <div className="card-meta" style={{ marginTop: 12 }}>
                Install command
              </div>
              <div className="mono desktop-command">{status.installCommand}</div>
            </>
          )}
        </div>
      )}
      {/* ========== Live View Section ========== */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <Video size={14} style={{ marginRight: 6 }} />
            Live View
          </span>
          {isActive && (
            <button
              className={`button small ${liveViewActive ? "danger" : "success"}`}
              onClick={(e) => {
                e.stopPropagation();
                if (liveViewActive) {
                  // Stop: close viewer then stop the stream process
                  setLiveViewActive(false);
                  void getClient()
                    .stopDesktopStream()
                    .catch(() => undefined);
                } else {
                  // Start stream first, then show viewer
                  void getClient()
                    .startDesktopStream()
                    .then(() => {
                      setLiveViewActive(true);
                    })
                    .catch(() => undefined);
                }
              }}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              {liveViewActive ? (
                <>
                  <Square size={12} style={{ marginRight: 4 }} />
                  Stop Stream
                </>
              ) : (
                <>
                  <Play size={12} style={{ marginRight: 4 }} />
                  Start Stream
                </>
              )}
            </button>
          )}
        </div>
        {liveViewError && (
          <div className="banner error" style={{ marginBottom: 8 }}>
            {liveViewError}
          </div>
        )}
        {!isActive && <div className="desktop-screenshot-empty">Start the desktop runtime to enable live view.</div>}
        {isActive && liveViewActive && <DesktopViewer client={viewerClient} autoStart={true} showStatusBar={true} />}
        {isActive && !liveViewActive && (
          <>
            {screenshotUrl ? (
              <div className="desktop-screenshot-frame">
                <img src={screenshotUrl} alt="Desktop screenshot" className="desktop-screenshot-image" />
              </div>
            ) : (
              <div className="desktop-screenshot-empty">Click "Start Stream" for live desktop view, or use the Screenshot button above.</div>
            )}
          </>
        )}
      </div>
      {/* ========== Recording Section ========== */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <Circle size={14} style={{ marginRight: 6, fill: activeRecording ? "#ff3b30" : "none" }} />
            Recording
          </span>
          {activeRecording && <span className="pill danger">Recording</span>}
        </div>
        {recordingError && (
          <div className="banner error" style={{ marginBottom: 8 }}>
            {recordingError}
          </div>
        )}
        {!isActive && <div className="desktop-screenshot-empty">Start the desktop runtime to enable recording.</div>}
        {isActive && (
          <>
            <div className="desktop-start-controls" style={{ gridTemplateColumns: "1fr" }}>
              <div className="desktop-input-group">
                <label className="label">FPS</label>
                <input
                  className="setup-input mono"
                  value={recordingFps}
                  onChange={(e) => setRecordingFps(e.target.value)}
                  inputMode="numeric"
                  style={{ maxWidth: 80 }}
                  disabled={!!activeRecording}
                />
              </div>
            </div>
            <div className="card-actions">
              {!activeRecording ? (
                <button className="button danger small" onClick={() => void handleStartRecording()} disabled={recordingActing === "start"}>
                  {recordingActing === "start" ? (
                    <Loader2 className="button-icon spinner-icon" />
                  ) : (
                    <Circle size={14} className="button-icon" style={{ fill: "#ff3b30" }} />
                  )}
                  Start Recording
                </button>
              ) : (
                <button className="button secondary small" onClick={() => void handleStopRecording()} disabled={recordingActing === "stop"}>
                  {recordingActing === "stop" ? <Loader2 className="button-icon spinner-icon" /> : <Square className="button-icon" />}
                  Stop Recording
                </button>
              )}
              <button className="button secondary small" onClick={() => void loadRecordings()} disabled={recordingLoading}>
                <RefreshCw className={`button-icon ${recordingLoading ? "spinner-icon" : ""}`} />
                Refresh
              </button>
            </div>
            {recordings.length > 0 && (
              <div className="desktop-process-list" style={{ marginTop: 12 }}>
                {recordings.map((rec) => (
                  <div key={rec.id} className="desktop-process-item">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <strong className="mono" style={{ fontSize: 12 }}>
                          {rec.fileName}
                        </strong>
                        <span
                          className={`pill ${rec.status === "recording" ? "danger" : rec.status === "completed" ? "success" : "warning"}`}
                          style={{ marginLeft: 8 }}
                        >
                          {rec.status}
                        </span>
                      </div>
                      {rec.status === "completed" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="button ghost small"
                            title="Download"
                            onClick={() => void handleDownloadRecording(rec.id, rec.fileName)}
                            disabled={downloadingRecordingId === rec.id}
                            style={{ padding: "4px 6px" }}
                          >
                            {downloadingRecordingId === rec.id ? <Loader2 size={14} className="spinner-icon" /> : <Download size={14} />}
                          </button>
                          <button
                            className="button ghost small"
                            title="Delete"
                            onClick={() => void handleDeleteRecording(rec.id)}
                            disabled={deletingRecordingId === rec.id}
                            style={{ padding: "4px 6px", color: "var(--danger)" }}
                          >
                            {deletingRecordingId === rec.id ? <Loader2 size={14} className="spinner-icon" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                      {formatBytes(rec.bytes)}
                      {" \u00b7 "}
                      {formatDuration(rec.startedAt, rec.endedAt)}
                      {" \u00b7 "}
                      {formatStartedAt(rec.startedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {recordings.length === 0 && !recordingLoading && (
              <div className="desktop-screenshot-empty" style={{ marginTop: 8 }}>
                No recordings yet. Click "Start Recording" to begin.
              </div>
            )}
          </>
        )}
      </div>
      {/* ========== Diagnostics Section ========== */}
      {(status?.lastError || status?.runtimeLogPath || (status?.processes?.length ?? 0) > 0) && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Diagnostics</span>
          </div>
          {status?.lastError && (
            <div className="desktop-diagnostic-block">
              <div className="card-meta">Last error</div>
              <div className="mono">{status.lastError.code}</div>
              <div>{status.lastError.message}</div>
            </div>
          )}
          {status?.runtimeLogPath && (
            <div className="desktop-diagnostic-block">
              <div className="card-meta">Runtime log</div>
              <div className="mono">{status.runtimeLogPath}</div>
            </div>
          )}
          {status?.processes && status.processes.length > 0 && (
            <div className="desktop-diagnostic-block">
              <div className="card-meta">Processes</div>
              <div className="desktop-process-list">
                {status.processes.map((process) => (
                  <div key={`${process.name}-${process.pid ?? "none"}`} className="desktop-process-item">
                    <div>
                      <strong>{process.name}</strong>
                      <span className={`pill ${process.running ? "success" : "danger"}`} style={{ marginLeft: 8 }}>
                        {process.running ? "running" : "stopped"}
                      </span>
                    </div>
                    <div className="mono">{process.pid ? `pid ${process.pid}` : "no pid"}</div>
                    {process.logPath && <div className="mono">{process.logPath}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default DesktopTab;
