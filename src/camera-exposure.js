// The Image Capture API expresses exposureTime in 100-microsecond units.
const timeUnitsPerSecond = 10000;
const validRange = (range) =>
  range &&
  Number.isFinite(range.min) &&
  Number.isFinite(range.max) &&
  range.max > range.min;
const snap = (value, range) => {
  const step = range.step > 0 ? range.step : 0;
  const rounded = step
    ? range.min + Math.round((value - range.min) / step) * step
    : value;
  return Number(
    Math.max(range.min, Math.min(range.max, rounded)).toPrecision(10),
  );
};
export function formatExposureTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "Not reported";
  const seconds = value / timeUnitsPerSecond;
  return seconds >= 1
    ? `${Number(seconds.toPrecision(3))} s`
    : `${Number((seconds * 1000).toPrecision(3))} ms`;
}
export function exposureTimes(range, current) {
  if (!validRange(range) || range.max <= 0) return [];
  const seconds = [
    0.0001,
    0.00025,
    0.0005,
    0.001,
    0.002,
    0.004,
    0.008,
    1 / 60,
    1 / 30,
    1 / 15,
    0.125,
    0.25,
    0.5,
    1,
    2,
    4,
    8,
    15,
    30,
    60,
  ];
  const values = [
    range.min,
    range.max,
    current,
    ...seconds.map((n) => n * timeUnitsPerSecond),
  ];
  return [
    ...new Set(
      values
        .filter(
          (n) =>
            Number.isFinite(n) && n > 0 && n >= range.min && n <= range.max,
        )
        .map((n) => snap(n, range))
        .filter((n) => n > 0),
    ),
  ].sort((a, b) => a - b);
}
export class CameraExposure {
  constructor(
    track,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.track = track;
    this.wait = wait;
    this.capabilities = track.getCapabilities?.() || {};
    this.initialFrameRate = track.getSettings?.().frameRate;
    this.initialFrameConstraint = track.getConstraints?.().frameRate;
  }
  get state() {
    return this.track.getSettings?.() || {};
  }
  get autoMode() {
    const modes = this.capabilities.exposureMode || [];
    return modes.includes("continuous")
      ? "continuous"
      : modes.includes("single-shot")
        ? "single-shot"
        : null;
  }
  get manualSupported() {
    return (
      (this.capabilities.exposureMode || []).includes("manual") &&
      validRange(this.capabilities.exposureTime) &&
      this.capabilities.exposureTime.max > 0
    );
  }
  get biasSupported() {
    return validRange(this.capabilities.exposureCompensation);
  }
  async apply(control, matches, frameRate, minimumWait = 1000) {
    if (this.track.readyState !== "live")
      throw new Error("Reconnect the camera first.");
    const settleTime = Math.min(
      60000,
      Math.max(minimumWait, (this.state.exposureTime || 0) / 10 + 500),
    );
    const previous = this.track.getConstraints?.() || {};
    const next = { ...previous };
    // Preserve resolution/facing constraints and unrelated camera controls.
    const keys = ["exposureMode", "exposureTime", "exposureCompensation"];
    for (const key of keys) delete next[key];
    next.advanced = (previous.advanced || [])
      .map((set) =>
        Object.fromEntries(
          Object.entries(set).filter(([key]) => !keys.includes(key)),
        ),
      )
      .filter((set) => Object.keys(set).length);
    next.advanced.push(control);
    if (frameRate !== undefined) next.frameRate = frameRate;
    try {
      await this.track.applyConstraints(next);
      for (let attempt = 0; attempt < Math.ceil(settleTime / 100); attempt++) {
        await this.wait(100);
        const state = this.state;
        if (matches(state)) return state;
      }
      throw new Error("The camera did not confirm that setting.");
    } catch (error) {
      // Do not keep an unconfirmed manual/auto mode change after a rejected request.
      try {
        await this.track.applyConstraints(previous);
      } catch {}
      throw error;
    }
  }
  async setTime(value) {
    if (value === "auto") {
      if (!this.autoMode)
        throw new Error(
          "This camera does not expose automatic exposure control.",
        );
      const frameRate =
        this.initialFrameConstraint ??
        (Number.isFinite(this.initialFrameRate)
          ? { ideal: this.initialFrameRate }
          : undefined);
      return this.apply(
        { exposureMode: this.autoMode },
        (state) => state.exposureMode === this.autoMode,
        frameRate,
      );
    }
    if (!this.manualSupported)
      throw new Error("Manual shutter control is unavailable in this browser.");
    const requested = Number(value),
      range = this.capabilities.exposureTime;
    if (
      !Number.isFinite(requested) ||
      requested <= 0 ||
      requested < range.min ||
      requested > range.max
    )
      throw new Error("That shutter time is outside this camera’s range.");
    const time = snap(requested, range);
    const control = { exposureMode: "manual", exposureTime: time };
    // Keep the reported ISO when leaving auto exposure instead of resetting gain.
    const iso = this.state.iso;
    if (validRange(this.capabilities.iso) && Number.isFinite(iso) && iso > 0)
      control.iso = snap(iso, this.capabilities.iso);
    const fps = timeUnitsPerSecond / time;
    const rate = this.capabilities.frameRate;
    const frameRate =
      validRange(rate) && rate.min <= fps && this.initialFrameRate > fps
        ? { ideal: Math.min(fps, rate.max) }
        : (this.initialFrameConstraint ??
          (Number.isFinite(this.initialFrameRate)
            ? { ideal: this.initialFrameRate }
            : undefined));
    const tolerance = Math.max(
      (range.step || 0) * 0.51,
      time * 0.005,
      0.000001,
    );
    return this.apply(
      control,
      (state) =>
        state.exposureMode === "manual" &&
        Number.isFinite(state.exposureTime) &&
        Math.abs(state.exposureTime - time) <= tolerance,
      frameRate,
      time / 10 + 500,
    );
  }
  async setBias(value) {
    if (!this.biasSupported)
      throw new Error("Auto exposure bias is unavailable in this browser.");
    if (this.state.exposureMode === "manual")
      throw new Error("Choose Auto exposure time before adjusting EV bias.");
    const range = this.capabilities.exposureCompensation;
    if (!Number.isFinite(value) || value < range.min || value > range.max)
      throw new Error("That EV bias is outside this camera’s range.");
    const bias = snap(value, range);
    const control = { exposureCompensation: bias };
    if (this.autoMode) control.exposureMode = this.autoMode;
    const tolerance = Math.max((range.step || 0) * 0.51, 0.000001);
    return this.apply(
      control,
      (state) =>
        Number.isFinite(state.exposureCompensation) &&
        Math.abs(state.exposureCompensation - bias) <= tolerance &&
        (this.autoMode
          ? state.exposureMode === this.autoMode
          : state.exposureMode !== "manual"),
    );
  }
}
