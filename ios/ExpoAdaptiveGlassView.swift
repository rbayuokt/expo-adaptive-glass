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
  var clarity: CGFloat = 0
  var glassTint: UIColor?
  var tintScheme = "system"
  var cornerRadius: CGFloat = 24
  var interactive = false
  var draggable = false
  let onMorphEnd = EventDispatcher()
  /// GlassMenu: the glass shows only this rect (x, y, width, height, radius) and springs to it
  /// when it changes. Child `morphIndex` is shown, the others fade out.
  var morphRect: [String: Double]?
  var morphIndex = 0
  let onMenuSelect = EventDispatcher()
  let onMenuDismiss = EventDispatcher()
  /// GlassMenu rows of the shown panel, [x, y, width, height] each. While set, the view takes every
  /// touch, slides a highlight under the finger and reports the row it's released on.
  var menuRows: [[Double]] = []
  /// GlassMenu button: a long press opens the menu and the same finger keeps driving it
  var menuTrigger = false
  let onMenuLongPress = EventDispatcher()
  private lazy var menuPress: UILongPressGestureRecognizer = {
    let r = UILongPressGestureRecognizer(target: self, action: #selector(handleMenuPress(_:)))
    r.minimumPressDuration = 0.3
    r.isEnabled = false
    r.delegate = self
    return r
  }()

  /// what is actually drawn, reported in stats
  private(set) var activeRenderer = "acrylic"

  // read and written by GlassPerformanceMonitor
  var lastWindowOrigin: CGPoint?
  var lastSampleTime: CFTimeInterval = 0

  private let host = UIView()
  private let effectView = UIVisualEffectView(effect: nil)
  private let material = AcrylicRenderer()
  private let materialView = UIView()
  private let partialBlur = PartialBlur()
  // RN children, shifted so they stay put while a morph moves the glass
  private let contentHost = UIView()
  private var morphActive = false
  private var morphFrom = MorphState()
  private var morphTo = MorphState()
  private var morphAppliedIndex = -1
  // button <-> panel morphs go through a round blob, panel <-> panel ones don't
  private var morphBlob = false
  private var morphEndSent = true
  private lazy var morphSpring = SpringDriver(count: 1) { [weak self] in self?.morphFrame() }
  private let highlight = UIView()
  // x, y, width, height, alpha
  private lazy var highlightSpring = SpringDriver(count: 5) { [weak self] in self?.placeHighlight() }
  private var hotRow = -1
  // x, y: how far the finger pulls the open panel, applied as a jelly stretch
  private lazy var pullSpring = SpringDriver(count: 2) { [weak self] in self?.morphFrame() }
  private var lastMenuPoint: CGPoint?
  private var appliedRows: [[Double]] = []
  private var appliedRowsIndex = -1
  private let selection = UISelectionFeedbackGenerator()
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
    contentHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    highlight.isUserInteractionEnabled = false
    highlight.alpha = 0
    highlight.layer.cornerRadius = 12
    if #available(iOS 13.0, *) { highlight.layer.cornerCurve = .continuous }
    effectView.contentView.addSubview(highlight)
    effectView.contentView.addSubview(contentHost)
    host.addSubview(effectView)
    addSubview(host)
    touch.isEnabled = false
    addGestureRecognizer(touch)
    addGestureRecognizer(drag)
    addGestureRecognizer(menuPress)
  }

  // MARK: - children

  // each child sits in a wrapper we own: Fabric rewrites the child's own opacity after mounting,
  // which would flash a panel that should still be hidden
  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    let wrapper = PassThroughView(frame: contentHost.bounds)
    wrapper.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    wrapper.addSubview(childComponentView)
    // a panel mounted mid-morph stays hidden until the morph picks it
    if morphActive { wrapper.alpha = index == morphAppliedIndex ? 1 : 0 }
    contentHost.insertSubview(wrapper, at: index)
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    let wrapper = childComponentView.superview
    childComponentView.removeFromSuperview()
    if wrapper?.superview === contentHost { wrapper?.removeFromSuperview() }
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
      if morphActive {
        morphFrame()
      } else {
        effectView.frame = host.bounds
        materialView.frame = host.bounds
        contentHost.frame = host.bounds
        if activeRenderer == "system" {
          SystemGlassRenderer.applyCorners(effectView, radius: effectiveRadius)
        } else {
          effectView.layer.cornerRadius = effectiveRadius
        }
        material.layout(bounds: host.bounds, radius: effectiveRadius, scale: window?.screen.scale ?? UIScreen.main.scale)
      }
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
    updateMorph()
    updateMenu()
    // RN resends every prop on each re-render. Rewriting identical values rebuilds iOS 26 glass
    // and blanks the screen behind it for a frame.
    let signature =
      "\(renderer)|\(quality)|\(blur)|\(refraction)|\(dynamicHighlights)|\(opaqueMaterial)|\(reduceMotion)|"
      + "\(intensity)|\(clarity)|\(String(describing: glassTint))|\(tintScheme)|\(cornerRadius)|\(interactive)|\(draggable)"
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
      ? SystemGlassRenderer.makeEffect(tint: glassTint, intensity: intensity, clear: clarity >= 0.5, interactive: false)
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
      .init(mode: mode, dark: dark, tint: glassTint, intensity: intensity, minimal: quality == "minimal", clarity: clarity, ultra: quality == "ultra"),
      animated: animated)

    // only inputs that change pixels: reassigning an identical effect can flash for a frame
    let key: String
    switch target {
    case "system": key = "system|\(String(describing: glassTint))|\(intensity)|\(clarity >= 0.5)"
    case "nativeBlur": key = "nativeBlur|\(blur)|\(clarity)|\(quality)"
    default: key = "acrylic"
    }
    guard key != appliedEffectKey else { return }
    let firstApply = appliedEffectKey == nil
    let wasSystem = appliedEffectKey?.hasPrefix("system") ?? false
    appliedEffectKey = key

    let effect: UIVisualEffect?
    switch target {
    case "system": effect = systemEffect
    case "nativeBlur": effect = NativeBlurRenderer.effect(blur: blur, clear: clarity >= 0.5)
    default: effect = nil
    }
    // system glass draws its edge and shadow outside the shape
    effectView.clipsToBounds = target != "system"
    let radius = morphActive ? currentMorph().radius : effectiveRadius
    if target == "system" {
      SystemGlassRenderer.applyCorners(effectView, radius: radius)
    } else {
      effectView.layer.cornerRadius = radius
    }

    // blank effect first, needed on mount only (expo/expo#43732)
    if target == "system" && firstApply {
      effectView.effect = UIVisualEffect()
    }
    // system materials can't blur less, so the blur is parked part way in, lighter with tier and clarity
    if target == "nativeBlur" {
      // the floor keeps clear glass reading as glass. Ultra goes lower, closer to iOS 26 clear glass
      let floor: CGFloat = quality == "ultra" ? 0.18 : 0.35
      partialBlur.apply(effect, amount: min(1, max(floor, (1.15 - 0.7 * blur) * (1 - 0.45 * clarity))), to: effectView)
      return
    }
    partialBlur.stop()
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

  // MARK: - morph

  private struct MorphState {
    var rect = CGRect.zero
    var radius: CGFloat = 0
    var alphas: [CGFloat] = []
  }

  private func currentMorph() -> MorphState {
    let t = morphSpring.value[0]
    var m = MorphState()
    m.rect = CGRect(
      x: morphFrom.rect.minX + (morphTo.rect.minX - morphFrom.rect.minX) * t,
      y: morphFrom.rect.minY + (morphTo.rect.minY - morphFrom.rect.minY) * t,
      width: morphFrom.rect.width + (morphTo.rect.width - morphFrom.rect.width) * t,
      height: morphFrom.rect.height + (morphTo.rect.height - morphFrom.rect.height) * t)
    let pill = min(m.rect.width, m.rect.height) / 2
    let tc = min(max(t, 0), 1)
    var radius = morphFrom.radius + (morphTo.radius - morphFrom.radius) * tc
    // roundness eases in from whichever shape we start at, so the corners never jump
    if morphBlob {
      let round = morphAppliedIndex == 0 ? 2 * tc - tc * tc : 1 - tc * tc
      radius = max(radius, pill * round)
    }
    m.radius = min(radius, pill)
    // outgoing content fades early, incoming overlaps it only briefly
    m.alphas = morphTo.alphas.indices.map { i in
      let from = i < morphFrom.alphas.count ? morphFrom.alphas[i] : 0
      let to = morphTo.alphas[i]
      let k = to > from ? min(max((t - 0.1) / 0.5, 0), 1) : min(max(t / 0.4, 0), 1)
      return from + (to - from) * k
    }
    return m
  }

  private func updateMorph() {
    guard let r = morphRect else {
      if morphActive {
        morphActive = false
        morphSpring.stop()
        contentHost.subviews.forEach {
          $0.alpha = 1
          $0.transform = .identity
        }
        pullSpring.stop()
        pullSpring.snap(0, 0)
        pullSpring.snap(1, 0)
        highlightSpring.stop()
        highlightSpring.snap(4, 0)
        highlight.alpha = 0
        hotRow = -1
        lastMenuPoint = nil
        if MenuFinger.menu === self { MenuFinger.menu = nil }
        laidOutSize = CGSize(width: -1, height: -1)
        setNeedsLayout()
      }
      return
    }
    let target = CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["width"] ?? 0, height: r["height"] ?? 0)
    let radius = CGFloat(r["radius"] ?? 0)
    let alphas = contentHost.subviews.indices.map { CGFloat($0 == morphIndex ? 1 : 0) }
    if !morphActive {
      morphActive = true
      morphTo = MorphState(rect: target, radius: radius, alphas: alphas)
      morphFrom = morphTo
      morphSpring.snap(0, 1)
      morphAppliedIndex = morphIndex
      morphFrame()
      return
    }
    guard target != morphTo.rect || radius != morphTo.radius || morphIndex != morphAppliedIndex else { return }
    morphFrom = currentMorph()
    morphTo = MorphState(rect: target, radius: radius, alphas: alphas)
    morphBlob = morphIndex == 0 || morphAppliedIndex == 0
    morphAppliedIndex = morphIndex
    morphEndSent = false
    // reduce motion: the shape jumps, only the content cross-fades
    if reduceMotion { morphFrom.rect = target; morphFrom.radius = radius }
    morphSpring.snap(0, 0)
    morphSpring.target[0] = 1
    // open overshoots a little, close is critically damped so it can't wobble into the button
    let opening = morphBlob && morphIndex != 0
    morphSpring.stiffness = opening ? 1100 : morphBlob ? 420 : 300
    morphSpring.damping = opening ? 0.62 : 1
    morphSpring.start()
  }

  // KONTOL ini morph matematikanya bikin pusing 3 hari, jangan diubah kalo ga ngerti. TODO rapihin nanti
  private func morphFrame() {
    guard morphActive else { return }
    var m = currentMorph()
    let base = m.rect
    m.rect = pulled(m.rect)
    let shift = CGPoint(x: m.rect.midX - base.midX, y: m.rect.midY - base.midY)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    effectView.frame = m.rect
    materialView.frame = effectView.bounds
    contentHost.frame = CGRect(x: -m.rect.minX, y: -m.rect.minY, width: bounds.width, height: bounds.height)
    if activeRenderer == "system" {
      SystemGlassRenderer.applyCorners(effectView, radius: m.radius)
    } else {
      effectView.layer.cornerRadius = m.radius
    }
    material.layout(bounds: effectView.bounds, radius: m.radius, scale: window?.screen.scale ?? UIScreen.main.scale)
    // content scales with the shape, centre to centre
    for (i, wrapper) in contentHost.subviews.enumerated() where i < m.alphas.count {
      wrapper.alpha = m.alphas[i]
      guard m.alphas[i] > 0, let child = wrapper.subviews.first, child.bounds.width > 0, child.bounds.height > 0
      else { continue }
      let k = min(m.rect.width / child.bounds.width, m.rect.height / child.bounds.height)
      // wrapper transforms about its own center w, this maps the child's center c onto the shape's
      let w = CGPoint(x: wrapper.bounds.midX, y: wrapper.bounds.midY)
      let c = child.center
      wrapper.transform = CGAffineTransform(
        a: k, b: 0, c: 0, d: k,
        tx: m.rect.midX - w.x - k * (c.x - w.x), ty: m.rect.midY - w.y - k * (c.y - w.y))
    }
    CATransaction.commit()
    placeHighlight(shift: shift)
    if !morphSpring.isRunning && !morphEndSent {
      morphEndSent = true
      onMorphEnd(["index": morphAppliedIndex])
    }
  }

  // MARK: - menu tracking

  private var menuActive: Bool { morphActive && !menuRows.isEmpty }

  private func updateMenu() {
    if menuPress.isEnabled != menuTrigger { menuPress.isEnabled = menuTrigger }
    if menuActive { MenuFinger.menu = self }
    // a submenu can have the same row rects as its parent, so the panel index counts too
    if menuRows != appliedRows || morphIndex != appliedRowsIndex {
      appliedRows = menuRows
      appliedRowsIndex = morphIndex
      hotRow = -1
      // a long press on the button is still down, its finger drives this menu
      if lastMenuPoint == nil, MenuFinger.moved, let p = MenuFinger.point { lastMenuPoint = convert(p, from: nil) }
      // a submenu took over under a finger that's still down, pick up from where it is
      if let p = lastMenuPoint { track(p) } else { highlightSpring.target[4] = 0; highlightSpring.start() }
    }
  }

  // jari dioper dari tombol ke menu, ANJG scroll view nyolong gesture mulu. kalo rusak lagi gw nyerah
  // forwards a long press on the button, in window points, to the open menu
  @objc private func handleMenuPress(_ r: UILongPressGestureRecognizer) {
    let p = r.location(in: nil)
    switch r.state {
    case .began:
      MenuFinger.point = p
      MenuFinger.start = p
      MenuFinger.moved = false
      // a scroll view around the button must not take the drag that follows
      if let pan = findScrollAncestor()?.panGestureRecognizer {
        pan.isEnabled = false
        pan.isEnabled = true
      }
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      onMenuLongPress([:])
    case .changed:
      MenuFinger.point = p
      if !MenuFinger.moved && hypot(p.x - MenuFinger.start.x, p.y - MenuFinger.start.y) > 10 { MenuFinger.moved = true }
      if MenuFinger.moved, let m = MenuFinger.menu, m.menuActive { m.track(m.convert(p, from: nil)) }
    case .ended:
      MenuFinger.point = nil
      guard let m = MenuFinger.menu, m.menuActive else { return }
      if MenuFinger.moved {
        m.release(m.convert(p, from: nil), direct: false)
      } else {
        m.track(CGPoint(x: -1, y: -1))
      }
    default:
      MenuFinger.point = nil
      if let m = MenuFinger.menu, m.menuActive { m.track(CGPoint(x: -1, y: -1)) }
    }
  }

  private func row(at p: CGPoint) -> Int {
    for (i, r) in menuRows.enumerated() where r.count >= 4 {
      // full panel width counts, so the edge of a row still hits it
      let rect = CGRect(x: r[0], y: r[1], width: r[2], height: r[3]).insetBy(dx: -8, dy: 0)
      if rect.contains(p) { return i }
    }
    return -1
  }

  private func track(_ p: CGPoint) {
    lastMenuPoint = p
    guard menuActive else { return }
    // (-1, -1) is how a cancelled press clears the highlight
    if p.x < 0 && p.y < 0 { letGo() } else { pull(toward: p) }
    let i = row(at: p)
    if i == hotRow { return }
    let wasHidden = hotRow < 0 && highlightSpring.value[4] < 0.05
    hotRow = i
    guard i >= 0 else {
      highlightSpring.target[4] = 0
      highlightSpring.start()
      return
    }
    let r = menuRows[i]
    let target: [CGFloat] = [r[0], r[1], r[2], r[3]].map { CGFloat($0) }
    for k in 0..<4 {
      if wasHidden { highlightSpring.snap(k, target[k]) } else { highlightSpring.target[k] = target[k] }
    }
    highlightSpring.target[4] = 1
    highlightSpring.stiffness = 520
    highlightSpring.damping = 1
    highlightSpring.start()
    selection.selectionChanged()
  }

  private func release(_ p: CGPoint, direct: Bool) {
    lastMenuPoint = nil
    guard menuActive else { return }
    letGo()
    let i = row(at: p)
    if i >= 0 {
      onMenuSelect(["index": i])
    } else if direct && !morphTo.rect.contains(p) {
      onMenuDismiss([:])
    }
    if i < 0 {
      hotRow = -1
      highlightSpring.target[4] = 0
      highlightSpring.start()
    }
  }

  // a slight lean toward the finger inside the panel, a rubber band past its edges
  private func pull(toward p: CGPoint) {
    let r = morphTo.rect
    guard r.width > 0 else { return }
    let limit: CGFloat = 36
    func rubber(_ o: CGFloat) -> CGFloat { o == 0 ? 0 : (o < 0 ? -1 : 1) * limit * (1 - 1 / (1 + abs(o) / limit)) }
    let ox = p.x - min(max(p.x, r.minX), r.maxX)
    let oy = p.y - min(max(p.y, r.minY), r.maxY)
    pullSpring.target[0] = rubber(ox) + (p.x - r.midX) * 0.02
    pullSpring.target[1] = rubber(oy) + (p.y - r.midY) * 0.02
    pullSpring.stiffness = 700
    pullSpring.damping = 0.85
    pullSpring.start()
  }

  private func letGo() {
    pullSpring.target[0] = 0
    pullSpring.target[1] = 0
    pullSpring.stiffness = 500
    pullSpring.damping = 0.55
    pullSpring.start()
  }

  // leading edge follows the pull, trailing edge lags, the other axis thins a little
  private func pulled(_ r: CGRect) -> CGRect {
    let dx = pullSpring.value[0]
    let dy = pullSpring.value[1]
    if abs(dx) < 0.01 && abs(dy) < 0.01 { return r }
    return r.offsetBy(dx: dx * 0.5, dy: dy * 0.5)
      .insetBy(dx: -abs(dx) * 0.25 + abs(dy) * 0.08, dy: -abs(dy) * 0.25 + abs(dx) * 0.08)
  }

  private func placeHighlight(shift: CGPoint = .zero) {
    guard morphActive else { return }
    let v = highlightSpring.value
    let origin = CGPoint(x: effectView.frame.minX - shift.x, y: effectView.frame.minY - shift.y)
    let dark = traitCollection.userInterfaceStyle == .dark
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    highlight.frame = CGRect(x: v[0] - origin.x, y: v[1] - origin.y, width: v[2], height: v[3])
    highlight.backgroundColor = dark ? UIColor(white: 1, alpha: 0.14) : UIColor(white: 0, alpha: 0.07)
    highlight.alpha = min(max(v[4], 0), 1)
    CATransaction.commit()
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard morphActive else { return super.hitTest(point, with: event) }
    // the open menu takes every touch, a closing one lets them through to the app
    return menuActive && bounds.contains(point) ? self : nil
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard menuActive, let t = touches.first else { return super.touchesBegan(touches, with: event) }
    let p = t.location(in: self)
    selection.prepare()
    track(p)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard menuActive, let t = touches.first else { return super.touchesMoved(touches, with: event) }
    track(t.location(in: self))
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard menuActive, let t = touches.first else { return super.touchesEnded(touches, with: event) }
    release(t.location(in: self), direct: true)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard menuActive else { return super.touchesCancelled(touches, with: event) }
    letGo()
    lastMenuPoint = nil
    hotRow = -1
    highlightSpring.target[4] = 0
    highlightSpring.start()
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

/// Hosts one RN child. Takes no touches itself, or it would cover its siblings.
private final class PassThroughView: UIView {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }
}

/// The finger of a GlassMenu button long press, shared with whichever menu is open.
private enum MenuFinger {
  static weak var menu: ExpoAdaptiveGlassView?
  static var point: CGPoint?
  static var start = CGPoint.zero
  // letting go without moving leaves the menu open instead of picking the row underneath
  static var moved = false
}
