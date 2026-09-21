import UIKit

/// Frame timing, motion and system state in ~500 ms windows. Main thread only. The display link runs
/// only while JS listens, the app is active and a glass view is on screen.
final class GlassPerformanceMonitor: NSObject {
  static let shared = GlassPerformanceMonitor()

  private static let windowSeconds: CFTimeInterval = 0.5
  private static let slowSpeed: CGFloat = 60  // pt/s
  private static let fastSpeed: CGFloat = 1200
  private static let settleSeconds: CFTimeInterval = 0.3

  private final class WeakView {
    weak var view: ExpoAdaptiveGlassView?
    init(_ v: ExpoAdaptiveGlassView) { view = v }
  }

  private var views: [WeakView] = []
  private var emit: (([String: Any]) -> Void)?
  private var link: CADisplayLink?
  private var appActive = true
  private var observersInstalled = false

  private var windowStart: CFTimeInterval = 0
  private var lastTimestamp: CFTimeInterval = 0
  private var frameSum: CFTimeInterval = 0
  private var expectedSum: CFTimeInterval = 0
  private var frames = 0
  private var dropped = 0
  private var worst: CFTimeInterval = 0

  private var scrollState = "idle"
  private var lastFastAt: CFTimeInterval = 0
  private var lastMovingAt: CFTimeInterval = 0

  private var lowMemoryUntil: CFTimeInterval = 0

  func startObserving(_ emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
    installObservers()
    resetWindow(now: CACurrentMediaTime())
    updateLink()
    emitNow()
  }

  func stopObserving() {
    emit = nil
    updateLink()
  }

  func register(_ view: ExpoAdaptiveGlassView) {
    views.removeAll { $0.view == nil || $0.view === view }
    views.append(WeakView(view))
    updateLink()
  }

  func unregister(_ view: ExpoAdaptiveGlassView) {
    views.removeAll { $0.view == nil || $0.view === view }
    updateLink()
  }

  // MARK: - display link

  private func updateLink() {
    let wanted = emit != nil && appActive && !views.isEmpty
    if wanted, link == nil {
      // weak proxy, the link would retain the monitor otherwise
      let l = CADisplayLink(target: LinkProxy(self), selector: #selector(LinkProxy.tick(_:)))
      l.add(to: .main, forMode: .common)
      link = l
      lastTimestamp = 0
      resetWindow(now: CACurrentMediaTime())
    } else if !wanted, let l = link {
      l.invalidate()
      link = nil
    }
  }

  fileprivate func tick(_ link: CADisplayLink) {
    let now = link.timestamp
    // the interval actually in use, ProMotion isn't always at 120 Hz
    var expected = link.targetTimestamp - link.timestamp
    if expected <= 0 { expected = link.duration > 0 ? link.duration : 1.0 / 60.0 }

    if lastTimestamp > 0 {
      let delta = now - lastTimestamp
      frameSum += delta
      expectedSum += expected
      frames += 1
      worst = max(worst, delta)
      if delta > expected * 1.5 {
        dropped += max(0, Int((delta / expected).rounded()) - 1)
      }
    }
    lastTimestamp = now

    sampleMotion(now: now)

    if now - windowStart >= Self.windowSeconds {
      emitNow()
    }
  }

  private func sampleMotion(now: CFTimeInterval) {
    var maxSpeed: CGFloat = 0
    for box in views {
      guard let v = box.view, v.window != nil else { continue }
      let origin = v.convert(CGPoint.zero, to: nil)
      if let last = v.lastWindowOrigin, v.lastSampleTime > 0 {
        let dt = now - v.lastSampleTime
        if dt > 0 {
          let dx = origin.x - last.x
          let dy = origin.y - last.y
          maxSpeed = max(maxSpeed, sqrt(dx * dx + dy * dy) / CGFloat(dt))
        }
      }
      v.lastWindowOrigin = origin
      v.lastSampleTime = now
    }

    if maxSpeed >= Self.fastSpeed { lastFastAt = now }
    if maxSpeed >= Self.slowSpeed { lastMovingAt = now }

    // escalate immediately, settle with a delay so a fling doesn't flicker
    let next: String
    if now - lastFastAt < Self.settleSeconds {
      next = "fast"
    } else if now - lastMovingAt < Self.settleSeconds {
      next = "slow"
    } else {
      next = "idle"
    }
    if next != scrollState {
      scrollState = next
      emitNow()
    }
  }

  // MARK: - emission

  private func resetWindow(now: CFTimeInterval) {
    windowStart = now
    frameSum = 0
    expectedSum = 0
    frames = 0
    dropped = 0
    worst = 0
  }

  func emitNow() {
    guard let emit else { return }
    let now = CACurrentMediaTime()
    let windowMs = max(0, (now - windowStart) * 1000)
    let expected = frames > 0 ? expectedSum / Double(frames) : 1.0 / Double(UIScreen.main.maximumFramesPerSecond)
    let total = frames + dropped
    let info = ProcessInfo.processInfo

    var surfaces: [[String: Any]] = []
    for box in views {
      guard let v = box.view, let window = v.window, !v.isHidden, v.alpha > 0.01 else { continue }
      let rect = v.convert(v.bounds, to: nil).intersection(window.bounds)
      if rect.isNull || rect.isEmpty { continue }
      surfaces.append([
        "id": v.surfaceId,
        "area": Double(rect.width * rect.height),
        "renderer": v.activeRenderer,
      ])
    }

    emit([
      "windowMs": windowMs,
      "sampleCount": frames,
      "refreshRate": (1.0 / expected).rounded(),
      "targetFrameTimeMs": expected * 1000,
      "averageFrameTimeMs": frames > 0 ? frameSum / Double(frames) * 1000 : 0,
      "worstFrameTimeMs": worst * 1000,
      "droppedFrameRatio": total > 0 ? Double(dropped) / Double(total) : 0,
      "thermalState": Self.thermalName(info.thermalState),
      "lowPowerMode": info.isLowPowerModeEnabled,
      "lowMemory": now < lowMemoryUntil,
      "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
      "reduceMotion": UIAccessibility.isReduceMotionEnabled,
      "scrollState": scrollState,
      "surfaces": surfaces,
    ])
    resetWindow(now: now)
  }

  private static func thermalName(_ s: ProcessInfo.ThermalState) -> String {
    switch s {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }

  // MARK: - system state

  private func installObservers() {
    guard !observersInstalled else { return }
    observersInstalled = true
    let nc = NotificationCenter.default
    let changes: [Notification.Name] = [
      ProcessInfo.thermalStateDidChangeNotification,
      .NSProcessInfoPowerStateDidChange,
      UIAccessibility.reduceTransparencyStatusDidChangeNotification,
      UIAccessibility.reduceMotionStatusDidChangeNotification,
    ]
    for name in changes {
      nc.addObserver(self, selector: #selector(systemStateChanged), name: name, object: nil)
    }
    nc.addObserver(
      self, selector: #selector(memoryWarning),
      name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
    nc.addObserver(
      self, selector: #selector(didEnterBackground),
      name: UIApplication.didEnterBackgroundNotification, object: nil)
    nc.addObserver(
      self, selector: #selector(didBecomeActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  // thermal and power notifications arrive on arbitrary queues
  @objc private func systemStateChanged() {
    DispatchQueue.main.async { self.emitNow() }
  }

  @objc private func memoryWarning() {
    DispatchQueue.main.async {
      self.lowMemoryUntil = CACurrentMediaTime() + 30
      self.emitNow()
    }
  }

  @objc private func didEnterBackground() {
    appActive = false
    updateLink()
  }

  @objc private func didBecomeActive() {
    appActive = true
    updateLink()
    emitNow()
  }
}

private final class LinkProxy: NSObject {
  weak var target: GlassPerformanceMonitor?
  init(_ target: GlassPerformanceMonitor) { self.target = target }
  @objc func tick(_ link: CADisplayLink) {
    if let target { target.tick(link) } else { link.invalidate() }
  }
}
