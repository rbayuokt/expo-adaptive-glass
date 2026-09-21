import ExpoModulesCore
import UIKit

/// Tab row for GlassTabBar. Holding swells the selected pill into a lens that magnifies and follows
/// the finger. With refraction on the lens is drawn by LensShaderRenderer, otherwise it's a moved
/// snapshot. The originals under the lens are masked out so nothing shows twice.
final class GlassLensView: ExpoView, UIGestureRecognizerDelegate {
  let onTabSelect = EventDispatcher()

  var selectedIndex = 0
  var lensStyle = "glass"
  var refraction = false
  var glassTint: UIColor?
  var tintScheme = "system"

  private let itemsView = UIView()
  private let itemsMask = CAShapeLayer()
  private let pill = UIView()
  private let lens = UIView()
  private let lensRim = CAGradientLayer()
  private let lensRimMask = CAShapeLayer()
  private var magnified: UIView?
  private var lensTintAlpha: CGFloat = 0.12
  private var lensShader: LensShaderRenderer?
  private var usingShader = false

  // center x, press 0..1, stretch
  private lazy var springs = SpringDriver(count: 3) { [weak self] in self?.applyFrame() }
  private var placed = false
  private var laidOutSize = CGSize.zero
  private var pressing = false
  private var lastX: CGFloat = 0
  private var lastTime: CFTimeInterval = 0
  private var velocity: CGFloat = 0

  private lazy var touch: UILongPressGestureRecognizer = {
    let r = UILongPressGestureRecognizer(target: self, action: #selector(handleTouch(_:)))
    r.minimumPressDuration = 0
    r.allowableMovement = .greatestFiniteMagnitude
    r.delegate = self
    return r
  }()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    // glass edges show as light, not an outline: glints top-left and bottom-right only.
    // Conic gradients start pointing right and turn clockwise.
    lensRim.type = .conic
    lensRim.startPoint = CGPoint(x: 0.5, y: 0.5)
    lensRim.endPoint = CGPoint(x: 1, y: 0.5)
    lensRim.locations = [0, 0.125, 0.3, 0.45, 0.625, 0.8, 1]
    lensRimMask.lineWidth = 1.5
    lensRimMask.fillColor = nil
    lensRimMask.strokeColor = UIColor.black.cgColor
    itemsMask.fillRule = .evenOdd
    lensRim.mask = lensRimMask
    pill.isUserInteractionEnabled = false
    if #available(iOS 13.0, *) {
      pill.layer.cornerCurve = .continuous
      lens.layer.cornerCurve = .continuous
    }
    lens.isUserInteractionEnabled = false
    lens.clipsToBounds = true
    lens.isHidden = true
    lens.layer.addSublayer(lensRim)
    addSubview(pill)
    addSubview(itemsView)
    addSubview(lens)
    addGestureRecognizer(touch)
    springs.snap(2, 1)
  }

  // MARK: - children

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    itemsView.insertSubview(childComponentView, at: index)
    placed = false
    setNeedsLayout()
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
    placed = false
    setNeedsLayout()
  }

  private var items: [UIView] { itemsView.subviews }

  // MARK: - layout

  override func layoutSubviews() {
    super.layoutSubviews()
    if itemsView.frame != bounds { itemsView.frame = bounds }
    // RN can lay the row out more than once while mounting, follow the final size
    let resized = bounds.size != laidOutSize
    laidOutSize = bounds.size
    if (!placed || resized) && !pressing, selectedIndex < items.count, items[selectedIndex].bounds.width > 0 {
      placed = true
      restyle()
      springs.snap(0, items[selectedIndex].frame.midX)
      springs.snap(1, 0)
      applyFrame()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { springs.stop() }
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    if previous?.userInterfaceStyle != traitCollection.userInterfaceStyle { restyle() }
  }

  func propsDidUpdate() {
    let style: UIUserInterfaceStyle =
      tintScheme == "light" ? .light : tintScheme == "dark" ? .dark : .unspecified
    if overrideUserInterfaceStyle != style { overrideUserInterfaceStyle = style }
    restyle()
    guard placed, !pressing, selectedIndex < items.count else {
      setNeedsLayout()
      return
    }
    settle(on: selectedIndex)
  }

  private func restyle() {
    let dark = traitCollection.userInterfaceStyle == .dark
    // white would vanish on a light bar
    pill.backgroundColor =
      glassTint?.withAlphaComponent(0.3) ?? (dark ? UIColor(white: 1, alpha: 0.16) : UIColor(white: 0, alpha: 0.07))
    let clear = UIColor.clear.cgColor
    lensRim.colors = [
      clear, UIColor(white: 1, alpha: 0.7).cgColor, clear, clear, UIColor(white: 1, alpha: 0.95).cgColor, clear, clear,
    ]
    // just a hint of body where it spills past the bar
    lensTintAlpha = dark ? 0.05 : 0.12
  }

  // MARK: - geometry, applied once per frame


  private func lensRect() -> CGRect {
    let v = springs.value
    let x = v[0]
    let press = v[1]
    let item = items[nearest(x)]
    // at rest the pill fills its tab slot, the bar's 4pt padding is the gap
    let pillH = bounds.height
    let pillW = item.frame.width
    // held: 1.18x the whole bar (row + 4pt padding each side), overflowing it like iOS 26
    let barH = bounds.height + 8
    let lensH = pillH + (barH * 1.18 - pillH) * press
    let w = (pillW + (max(pillW * 1.25, lensH * 1.2) - pillW) * press) * v[2]
    return CGRect(x: x - w / 2, y: bounds.midY - lensH / 2, width: w, height: lensH)
  }

  private func applyFrame() {
    guard !items.isEmpty else { return }
    let press = springs.value[1]
    let rect = lensRect()
    let radius = rect.height / 2

    CATransaction.begin()
    CATransaction.setDisableActions(true)

    pill.frame = rect
    pill.alpha = 1 - press
    pill.layer.cornerRadius = radius

    let lensUp = press > 0.001 && magnified != nil
    lens.isHidden = !lensUp
    if lensUp {
      lens.frame = rect
      // stays opaque: as press falls the copy converges onto the originals, fading it would
      // leave the masked originals blank for a few frames
      lens.alpha = 1
      lens.backgroundColor = UIColor(white: 1, alpha: lensTintAlpha * press)
      lensRim.opacity = Float(press)
      lens.layer.cornerRadius = radius
      lensRim.frame = lens.bounds
      lensRimMask.path = UIBezierPath(roundedRect: lens.bounds.insetBy(dx: 0.75, dy: 0.75), cornerRadius: radius).cgPath
      if usingShader {
        updateShader(x: springs.value[0], press: press, rect: rect)
      } else {
        placeMagnified(x: springs.value[0], scale: 1 + 0.2 * press)
      }
      let hole = UIBezierPath(rect: itemsView.bounds)
      hole.append(UIBezierPath(roundedRect: rect, cornerRadius: radius))
      itemsMask.frame = itemsView.bounds
      itemsMask.path = hole.cgPath
      if itemsView.layer.mask == nil { itemsView.layer.mask = itemsMask }
    } else if itemsView.layer.mask != nil {
      itemsView.layer.mask = nil
    }

    // sublayerTransform leaves RN's transform alone
    let k = 1 + 0.03 * press
    superview?.layer.sublayerTransform = press > 0.001 ? CATransform3DMakeScale(k, k, 1) : CATransform3DIdentity

    CATransaction.commit()

    if !pressing && press <= 0.001 && magnified != nil && !springs.isRunning {
      magnified?.removeFromSuperview()
      magnified = nil
      if usingShader { lensShader?.release() }
      usingShader = false
    }
  }

  private var screenScale: CGFloat { window?.screen.scale ?? UIScreen.main.scale }

  private func updateShader(x: CGFloat, press: CGFloat, rect: CGRect) {
    guard let shader = lensShader else { return }
    let scale = screenScale
    shader.view.frame = lens.bounds
    let drawable = CGSize(width: (rect.width * scale).rounded(), height: (rect.height * scale).rounded())
    if shader.view.drawableSize != drawable { shader.view.drawableSize = drawable }
    var u = shader.uniforms
    u.center = SIMD2(Float(x * scale), Float(bounds.midY * scale))
    u.magnification = Float(1 + 0.2 * press)
    u.radius = Float(rect.height / 2 * scale)
    // same numbers as the Android lens
    u.bezel = Float(rect.height * 0.28 * scale)
    u.refraction = Float(10 * scale * press)
    u.chroma = 1
    u.press = Float(press)
    shader.uniforms = u
    shader.render()
  }

  /// keeps the point under the lens center at the center, magnified
  private func placeMagnified(x: CGFloat, scale: CGFloat) {
    guard let copy = magnified else { return }
    copy.bounds = CGRect(origin: .zero, size: itemsView.bounds.size)
    let lb = lens.bounds
    copy.transform = CGAffineTransform(scaleX: scale, y: scale)
    copy.center = CGPoint(
      x: lb.midX - (x - itemsView.bounds.midX) * scale,
      y: lb.midY - (bounds.midY - itemsView.bounds.midY) * scale
    )
  }

  private func settle(on index: Int) {
    guard index < items.count else { return }
    springs.target[0] = items[index].frame.midX
    springs.target[1] = 0
    springs.target[2] = 1
    springs.stiffness = 420
    springs.damping = 1
    springs.start()
  }

  // MARK: - touch

  @objc private func handleTouch(_ r: UILongPressGestureRecognizer) {
    guard !items.isEmpty else { return }
    let x = clampX(r.location(in: self).x)
    let now = CACurrentMediaTime()
    switch r.state {
    case .began:
      pressing = true
      lastX = x
      lastTime = now
      velocity = 0
      let lensAllowed = !UIAccessibility.isReduceMotionEnabled && lensStyle == "glass"
      if lensAllowed && magnified == nil {
        // one capture per press
        if refraction, let shader = lensShader ?? LensShaderRenderer(frame: .zero),
          shader.load(from: itemsView, scale: screenScale)
        {
          lensShader = shader
          lens.insertSubview(shader.view, at: 0)
          magnified = shader.view
          usingShader = true
        } else if let copy = itemsView.snapshotView(afterScreenUpdates: false) {
          copy.isUserInteractionEnabled = false
          lens.insertSubview(copy, at: 0)
          magnified = copy
          usingShader = false
        }
      }
      springs.target[0] = x
      springs.target[1] = lensAllowed ? 1 : 0
      springs.target[2] = 1
      springs.stiffness = 700
      springs.damping = 1
      springs.start()
    case .changed:
      let dt = max(now - lastTime, 1.0 / 240)
      velocity = 0.7 * velocity + 0.3 * (x - lastX) / CGFloat(dt)
      lastX = x
      lastTime = now
      springs.target[0] = x
      springs.target[2] = 1 + min(0.3, abs(velocity) / 2500)
      springs.start()
    case .ended:
      pressing = false
      let index = nearest(x)
      settle(on: index)
      if index != selectedIndex {
        selectedIndex = index
        onTabSelect(["index": index])
      }
    default:
      pressing = false
      settle(on: selectedIndex)
    }
  }

  private func clampX(_ x: CGFloat) -> CGFloat {
    guard let first = items.first, let last = items.last else { return x }
    return min(max(x, first.frame.midX), last.frame.midX)
  }

  private func nearest(_ x: CGFloat) -> Int {
    var best = 0
    var bestDistance = CGFloat.greatestFiniteMagnitude
    for (i, item) in items.enumerated() {
      let d = abs(item.frame.midX - x)
      if d < bestDistance {
        bestDistance = d
        best = i
      }
    }
    return best
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}

/// Damped springs on a display link that stops once they settle. Same model as SpringSet on Android.
final class SpringDriver {
  var value: [CGFloat]
  var target: [CGFloat]
  private var velocity: [CGFloat]
  var stiffness: CGFloat = 500
  var damping: CGFloat = 0.75
  private let onFrame: () -> Void
  private var link: CADisplayLink?
  private var lastTimestamp: CFTimeInterval = 0

  init(count: Int, onFrame: @escaping () -> Void) {
    value = Array(repeating: 0, count: count)
    target = Array(repeating: 0, count: count)
    velocity = Array(repeating: 0, count: count)
    self.onFrame = onFrame
  }

  var isRunning: Bool { link != nil }

  func snap(_ i: Int, _ v: CGFloat) {
    value[i] = v
    target[i] = v
    velocity[i] = 0
  }

  func start() {
    guard link == nil else { return }
    let l = CADisplayLink(target: SpringLinkProxy(self), selector: #selector(SpringLinkProxy.tick(_:)))
    l.add(to: .main, forMode: .common)
    link = l
    lastTimestamp = 0
  }

  func stop() {
    link?.invalidate()
    link = nil
  }

  fileprivate func step(_ l: CADisplayLink) {
    // clamped so a stalled frame can't blow the spring up
    let dt = lastTimestamp == 0 ? 1.0 / 60 : min(l.timestamp - lastTimestamp, 1.0 / 30)
    lastTimestamp = l.timestamp
    let c = 2 * damping * stiffness.squareRoot()
    var moving = false
    for i in value.indices {
      let a = -stiffness * (value[i] - target[i]) - c * velocity[i]
      velocity[i] += a * CGFloat(dt)
      value[i] += velocity[i] * CGFloat(dt)
      if abs(value[i] - target[i]) > 0.0005 * max(1, abs(target[i])) || abs(velocity[i]) > 0.001 { moving = true }
    }
    if !moving {
      for i in value.indices {
        value[i] = target[i]
        velocity[i] = 0
      }
      stop()
    }
    onFrame()
  }
}

private final class SpringLinkProxy: NSObject {
  weak var driver: SpringDriver?
  init(_ driver: SpringDriver) { self.driver = driver }
  @objc func tick(_ l: CADisplayLink) {
    if let driver { driver.step(l) } else { l.invalidate() }
  }
}
