import ExpoModulesCore
import UIKit

/// One GlassSurface. Glass and children live in `host`, whose transform carries press and drag,
/// so React Native keeps ownership of this view's own transform.
final class ExpoAdaptiveGlassView: ExpoView, UIGestureRecognizerDelegate {
  let onInteractionStart = EventDispatcher()
  let onInteractionEnd = EventDispatcher()
  let onDragStart = EventDispatcher()
  let onDragEnd = EventDispatcher()

  var surfaceId = ""
  var renderer = "acrylic"
  var quality = "high"
  var blur: CGFloat = 1
  var refraction: CGFloat = 0
  var dynamicHighlights = false
  var opaqueMaterial = false
  var reduceMotion = false
  var intensity: CGFloat = 0.6
  var glassTint: UIColor?
  var tintScheme = "system"
  var cornerRadius: CGFloat = 24
  var interactive = false
  var draggable = false

  /// what is actually drawn, reported in stats
  private(set) var activeRenderer = "acrylic"

  // read and written by GlassPerformanceMonitor
  var lastWindowOrigin: CGPoint?
  var lastSampleTime: CFTimeInterval = 0

  private let host = UIView()
  private let effectView = UIVisualEffectView(effect: nil)
  private let material = AcrylicRenderer()
  private let materialView = UIView()
  private var appliedEffectKey: String?
  private var isLaidOut = false
  private var laidOutSize = CGSize(width: -1, height: -1)
  private var laidOutRadius: CGFloat = -1
  // layout can run before the first props arrive, and applying defaults then flashes acrylic
  private var hasProps = false
  private var appliedProps = ""
  private var attachedAt: CFTimeInterval = 0

  private lazy var touch: GlassTouchRecognizer = {
    let r = GlassTouchRecognizer(target: self, action: #selector(handleTouch(_:)))
    r.minimumPressDuration = 0
    r.cancelsTouchesInView = false
    r.delaysTouchesBegan = false
    r.delaysTouchesEnded = false
    r.delegate = self
    return r
  }()
  private var pressed = false
  private var pressStart = CGPoint.zero
  private var pressT = CGAffineTransform.identity
  private var dragOffset = CGPoint.zero
  private var dragging = false
  private lazy var drag: UIPanGestureRecognizer = {
    let r = UIPanGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
    r.delegate = self
    r.isEnabled = false
    return r
  }()
  private weak var group: GlassGroupView?
  /// iOS < 26: the group draws the glass, this view only keeps its content
  private var grouped = false
  private weak var scrollAncestor: UIScrollView?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    effectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    effectView.clipsToBounds = true
    if #available(iOS 13.0, *) { effectView.layer.cornerCurve = .continuous }
    materialView.isUserInteractionEnabled = false
    materialView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    materialView.layer.addSublayer(material.root)
    effectView.contentView.addSubview(materialView)
    host.addSubview(effectView)
    addSubview(host)
    touch.isEnabled = false
    addGestureRecognizer(touch)
    addGestureRecognizer(drag)
  }

  // MARK: - children

  // materialView is at index 0 of the contentView, so RN indices shift by one
  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    effectView.contentView.insertSubview(childComponentView, at: index + 1)
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  /// 999 means capsule. Past half the short side, layer and glass corners misbehave.
  private var effectiveRadius: CGFloat { min(cornerRadius, min(bounds.width, bounds.height) / 2) }

  // MARK: - lifecycle

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      attachedAt = CACurrentMediaTime()
      lastWindowOrigin = nil
      GlassPerformanceMonitor.shared.register(self)
      joinGroup()
      // UIGlassEffect only renders correctly when applied during layout (expo/expo#43732)
      appliedEffectKey = nil
      setNeedsLayout()
    } else {
      GlassPerformanceMonitor.shared.unregister(self)
      group?.unregister(self)
      group = nil
      isLaidOut = false
      endPress(animated: false)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // only on real geometry changes: even identical writes make iOS 26 rebuild the glass,
    // which blanks the screen behind it for a frame
    let size = bounds.size
    if size != laidOutSize || cornerRadius != laidOutRadius {
      laidOutSize = size
      laidOutRadius = cornerRadius
      // host may be transformed mid-press, bounds and center ignore that
      host.bounds = CGRect(origin: .zero, size: size)
      host.center = CGPoint(x: bounds.midX, y: bounds.midY)
      effectView.frame = host.bounds
      materialView.frame = host.bounds
      if activeRenderer == "system" {
        SystemGlassRenderer.applyCorners(effectView, radius: effectiveRadius)
      } else {
        effectView.layer.cornerRadius = effectiveRadius
      }
      material.layout(bounds: host.bounds, radius: effectiveRadius, scale: window?.screen.scale ?? UIScreen.main.scale)
    }
    if !isLaidOut && hasProps {
      isLaidOut = true
      apply(animated: false)
    }
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    if previous?.userInterfaceStyle != traitCollection.userInterfaceStyle {
      apply(animated: false)
    }
  }

  // MARK: - group

  private func joinGroup() {
    var v = superview
    while let current = v, !(current is GlassGroupView) { v = current.superview }
    group = v as? GlassGroupView
    setGrouped(group?.register(self) ?? false)
  }

  func setGrouped(_ value: Bool) {
    guard value != grouped else { return }
    grouped = value
    materialView.isHidden = value
    appliedEffectKey = nil
    if isLaidOut { apply(animated: false) }
  }

  // MARK: - props

  func propsDidUpdate() {
    // RN resends every prop on each re-render. Rewriting identical values rebuilds iOS 26 glass
    // and blanks the screen behind it for a frame.
    let signature =
      "\(renderer)|\(quality)|\(blur)|\(refraction)|\(dynamicHighlights)|\(opaqueMaterial)|\(reduceMotion)|"
      + "\(intensity)|\(String(describing: glassTint))|\(tintScheme)|\(cornerRadius)|\(interactive)|\(draggable)"
    if hasProps && signature == appliedProps { return }
    appliedProps = signature
    hasProps = true
    if touch.isEnabled != interactive { touch.isEnabled = interactive }
    if drag.isEnabled != draggable { drag.isEnabled = draggable }
    if !interactive { endPress(animated: true) }
    guard isLaidOut else {
      setNeedsLayout()
      return
    }
    if cornerRadius != laidOutRadius { setNeedsLayout() }
    // no cross-fade right after mount, e.g. the first budget pass
    apply(animated: CACurrentMediaTime() - attachedAt > 0.3)
  }

  private func apply(animated: Bool) {
    let style: UIUserInterfaceStyle =
      tintScheme == "light" ? .light : tintScheme == "dark" ? .dark : .unspecified
    // any write, same value or not, pushes a trait change through the glass
    if overrideUserInterfaceStyle != style { overrideUserInterfaceStyle = style }
    let dark = traitCollection.userInterfaceStyle == .dark

    var target = renderer
    // isInteractive never fires with RN content filling the glass (iOS 26.1), so our own press
    // motion covers system glass too
    let systemEffect: UIVisualEffect? =
      target == "system"
      ? SystemGlassRenderer.makeEffect(tint: glassTint, intensity: intensity, interactive: false)
      : nil
    if target == "system" && systemEffect == nil { target = "nativeBlur" }
    if target == "shaderGlass" { target = "nativeBlur" }  // Android only
    if opaqueMaterial { target = "acrylic" }
    activeRenderer = target
    // the group draws one merged shape, our own glass would double it
    if grouped { target = "grouped" }

    let mode: AcrylicRenderer.Mode =
      opaqueMaterial ? .opaque : target == "system" ? .system : target == "nativeBlur" ? .liveBlur : .acrylic
    material.apply(
      .init(mode: mode, dark: dark, tint: glassTint, intensity: intensity, minimal: quality == "minimal"),
      animated: animated)

    // only inputs that change pixels: reassigning an identical effect can flash for a frame
    let key: String
    switch target {
    case "system": key = "system|\(String(describing: glassTint))|\(intensity)"
    case "nativeBlur": key = "nativeBlur|\(blur >= 0.85)"
    default: key = "acrylic"
    }
    guard key != appliedEffectKey else { return }
    let firstApply = appliedEffectKey == nil
    let wasSystem = appliedEffectKey?.hasPrefix("system") ?? false
    appliedEffectKey = key

    let effect: UIVisualEffect?
    switch target {
    case "system": effect = systemEffect
    case "nativeBlur": effect = NativeBlurRenderer.effect(blur: blur)
    default: effect = nil
    }
    // system glass draws its edge and shadow outside the shape
    effectView.clipsToBounds = target != "system"
    if target == "system" {
      SystemGlassRenderer.applyCorners(effectView, radius: effectiveRadius)
    } else {
      effectView.layer.cornerRadius = effectiveRadius
    }

    // blank effect first, needed on mount only (expo/expo#43732)
    if target == "system" && firstApply {
      effectView.effect = UIVisualEffect()
    }
    let change = {
      // nil doesn't clear a glass effect, an empty UIVisualEffect does
      self.effectView.effect = effect ?? (wasSystem ? UIVisualEffect() : nil)
    }
    if animated {
      UIView.animate(
        withDuration: 0.3, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction], animations: change)
    } else {
      change()
    }
  }

  // MARK: - press motion

  @objc private func handleTouch(_ r: UILongPressGestureRecognizer) {
    let p = r.location(in: self)
    switch r.state {
    case .began:
      pressed = true
      pressStart = p
      scrollAncestor = findScrollAncestor()
      onInteractionStart([:])
      material.setHighlight(at: reduceMotion ? CGPoint(x: bounds.midX, y: bounds.minY) : p, visible: true)
      setPress(pressTransform(at: p), release: false)
    case .changed:
      // the list took over, not a press anymore
      if let s = scrollAncestor, s.isDragging || s.isDecelerating {
        r.isEnabled = false
        r.isEnabled = interactive
        endPress(animated: true)
        return
      }
      if dynamicHighlights && !reduceMotion { material.setHighlight(at: p, visible: true) }
      setPress(pressTransform(at: p), release: false)
    default:
      endPress(animated: true)
    }
  }

  private func pressTransform(at p: CGPoint) -> CGAffineTransform {
    if reduceMotion { return .identity }
    let size = max(bounds.width, bounds.height, 1)
    // fixed few points, so large cards don't balloon
    let grow = min(0.08, 12 / size)
    let dx = p.x - pressStart.x
    let dy = p.y - pressStart.y
    let ex = min(1, abs(dx) / 60)
    let ey = min(1, abs(dy) / 60)
    let sx = 1 + grow + 0.06 * ex - 0.03 * ey
    let sy = 1 + grow + 0.06 * ey - 0.03 * ex
    // draggable surfaces already move with the finger
    let lean: CGFloat = draggable ? 0 : 0.15
    let tx = max(-12, min(12, dx * lean))
    let ty = max(-12, min(12, dy * lean))
    return CGAffineTransform(translationX: tx, y: ty).scaledBy(x: sx, y: sy)
  }

  private var hostTransform: CGAffineTransform {
    pressT.concatenating(CGAffineTransform(translationX: dragOffset.x, y: dragOffset.y))
  }

  private func setPress(_ t: CGAffineTransform, release: Bool) {
    pressT = t
    animateHost(release: release)
  }

  private func animateHost(release: Bool, velocity: CGFloat = 0) {
    // transform only, nothing is re-blurred. Damping 1 settles without bounce.
    let t = hostTransform
    UIView.animate(
      withDuration: release ? 0.4 : 0.3, delay: 0,
      usingSpringWithDamping: 1, initialSpringVelocity: velocity,
      options: [.beginFromCurrentState, .allowUserInteraction]
    ) {
      self.host.transform = t
    }
  }

  // MARK: - drag

  @objc private func handleDrag(_ r: UIPanGestureRecognizer) {
    switch r.state {
    case .began:
      dragging = true
      onDragStart([:])
    case .changed:
      let t = r.translation(in: superview)
      dragOffset = t
      // no spring while dragging, it would lag the finger
      host.layer.removeAllAnimations()
      host.transform = hostTransform
    default:
      guard dragging else { return }
      dragging = false
      let end = dragOffset
      let v = r.velocity(in: superview)
      let distance = max(hypot(end.x, end.y), 1)
      dragOffset = .zero
      // carry the release speed into the return so a flick feels continuous
      animateHost(release: true, velocity: min(hypot(v.x, v.y) / distance, 20))
      onDragEnd(["x": end.x, "y": end.y])
    }
  }

  /// carries press and drag transforms, read by GlassGroupView
  var glassLayer: CALayer { host.layer }

  private func endPress(animated: Bool) {
    guard pressed else { return }
    pressed = false
    material.setHighlight(at: nil, visible: false)
    pressT = .identity
    if animated { animateHost(release: true) } else if !dragging { host.transform = hostTransform }
    onInteractionEnd([:])
  }

  private func findScrollAncestor() -> UIScrollView? {
    var v = superview
    while let current = v {
      if let s = current as? UIScrollView { return s }
      v = current.superview
    }
    return nil
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    g !== drag
  }

  // scroll views wait for the drag to fail
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    g === drag && other.view is UIScrollView
  }
}

private final class GlassTouchRecognizer: UILongPressGestureRecognizer {
  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
