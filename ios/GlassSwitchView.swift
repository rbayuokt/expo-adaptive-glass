import ExpoModulesCore
import UIKit

/// iOS 26 style switch. Pressing turns the white thumb into a clear lens over the track, dragging
/// moves it and blends the track colour, releasing settles it on the nearest side.
final class GlassSwitchView: ExpoView, UIGestureRecognizerDelegate {
  let onValueChange = EventDispatcher()

  var value = false
  var disabled = false
  var onColor: UIColor?
  var lens = true

  private let track = CALayer()
  private let trackMask = CAShapeLayer()
  private let thumb = CALayer()
  private let lensView = UIView()
  private let lensRim = CAGradientLayer()
  private let lensRimMask = CAShapeLayer()
  private var shader: LensShaderRenderer?
  // plain magnified copy when Metal is not available
  private let fallbackTrack = CALayer()

  // thumb position 0..1, press 0..1
  private lazy var springs = SpringDriver(count: 2) { [weak self] in self?.applyFrame() }
  private var placed = false
  private var dragging = false
  private var moved = false
  private var downX: CGFloat = 0
  private var downPos: CGFloat = 0

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
    trackMask.fillRule = .evenOdd
    thumb.backgroundColor = UIColor.white.cgColor
    thumb.shadowColor = UIColor.black.cgColor
    thumb.shadowOpacity = 0.15
    thumb.shadowRadius = 3
    thumb.shadowOffset = CGSize(width: 0, height: 1.5)
    if #available(iOS 13.0, *) {
      track.cornerCurve = .continuous
      thumb.cornerCurve = .continuous
      lensView.layer.cornerCurve = .continuous
    }
    lensView.isUserInteractionEnabled = false
    lensView.clipsToBounds = true
    lensView.isHidden = true
    // glass edges show as light, glints top-left and bottom-right only
    lensRim.type = .conic
    lensRim.startPoint = CGPoint(x: 0.5, y: 0.5)
    lensRim.endPoint = CGPoint(x: 1, y: 0.5)
    lensRim.locations = [0, 0.125, 0.3, 0.45, 0.625, 0.8, 1]
    // transparent white, UIColor.clear is black and greys the fade
    let clear = UIColor(white: 1, alpha: 0).cgColor
    lensRim.colors = [
      clear, UIColor(white: 1, alpha: 0.7).cgColor, clear, clear, UIColor(white: 1, alpha: 0.95).cgColor, clear, clear,
    ]
    lensRimMask.fillColor = nil
    lensRimMask.strokeColor = UIColor.black.cgColor
    lensRimMask.lineWidth = 1.5
    lensRim.mask = lensRimMask
    lensView.layer.addSublayer(fallbackTrack)
    lensView.layer.addSublayer(lensRim)
    layer.addSublayer(track)
    addSubview(lensView)
    // drawn over the lens, so on release its fade-in hides the shrinking lens
    layer.addSublayer(thumb)
    addGestureRecognizer(touch)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    applyFrame()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      springs.stop()
      shader?.release()
    }
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    applyFrame()
  }

  func propsDidUpdate() {
    alpha = disabled ? 0.45 : 1
    touch.isEnabled = !disabled
    let target: CGFloat = value ? 1 : 0
    if !placed {
      springs.snap(0, target)
      springs.snap(1, 0)
      placed = true
      applyFrame()
    } else if !dragging {
      settle(target)
    }
  }

  private func settle(_ pos: CGFloat) {
    springs.target[0] = pos
    springs.target[1] = 0
    springs.stiffness = 420
    springs.damping = 1
    springs.start()
  }

  // MARK: - geometry

  private var inset: CGFloat { 2 }
  private var restSize: CGSize {
    let h = bounds.height - 2 * inset
    return CGSize(width: h * 1.55, height: h)
  }

  private func trackColor(_ pos: CGFloat) -> UIColor {
    let dark = traitCollection.userInterfaceStyle == .dark
    let off = dark ? UIColor(red: 57 / 255, green: 57 / 255, blue: 61 / 255, alpha: 1) : UIColor(white: 233 / 255, alpha: 1)
    let on = onColor ?? UIColor(red: 52 / 255, green: 199 / 255, blue: 89 / 255, alpha: 1)
    var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    var (r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    off.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
    on.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
    let t = min(max(pos, 0), 1)
    return UIColor(red: r1 + (r2 - r1) * t, green: g1 + (g2 - g1) * t, blue: b1 + (b2 - b1) * t, alpha: 1)
  }

  private func thumbRect(pos: CGFloat, press: CGFloat) -> CGRect {
    let rest = restSize
    let lensH = bounds.height * 1.4
    let lensW = lensH * 1.5
    let w = rest.width + (lensW - rest.width) * press
    let h = rest.height + (lensH - rest.height) * press
    let travel = bounds.width - 2 * inset - rest.width
    let cx = inset + rest.width / 2 + travel * pos
    return CGRect(x: cx - w / 2, y: bounds.midY - h / 2, width: w, height: h)
  }

  private func applyFrame() {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let pos = springs.value[0]
    let press = lens ? springs.value[1] : 0
    let rect = thumbRect(pos: pos, press: press)
    let radius = rect.height / 2
    let color = trackColor(pos)

    CATransaction.begin()
    CATransaction.setDisableActions(true)

    track.frame = bounds
    track.cornerRadius = bounds.height / 2
    track.backgroundColor = color.cgColor

    thumb.frame = rect
    thumb.cornerRadius = radius
    thumb.opacity = Float(1 - press)
    thumb.shadowPath = UIBezierPath(roundedRect: CGRect(origin: .zero, size: rect.size), cornerRadius: radius).cgPath

    let lensUp = press > 0.001
    lensView.isHidden = !lensUp
    if lensUp {
      // masked under the lens so the track doesn't show twice
      let hole = UIBezierPath(rect: bounds)
      hole.append(UIBezierPath(roundedRect: rect, cornerRadius: radius))
      trackMask.frame = bounds
      trackMask.path = hole.cgPath
      if track.mask == nil { track.mask = trackMask }

      lensView.frame = rect
      lensView.layer.cornerRadius = radius
      lensRim.frame = lensView.bounds
      lensRim.opacity = Float(press)
      lensRimMask.path = UIBezierPath(roundedRect: lensView.bounds.insetBy(dx: 0.75, dy: 0.75), cornerRadius: radius).cgPath
      drawLens(rect: rect, press: press, color: color)
    } else if track.mask != nil {
      track.mask = nil
    }

    CATransaction.commit()
  }

  private func drawLens(rect: CGRect, press: CGFloat, color: UIColor) {
    let magnification = 1 + 0.05 * press
    if let shader = shader ?? LensShaderRenderer(frame: .zero) {
      if self.shader == nil {
        self.shader = shader
        lensView.insertSubview(shader.view, at: 0)
      }
      fallbackTrack.isHidden = true
      let scale = window?.screen.scale ?? UIScreen.main.scale
      let size = bounds.size
      // the track is a flat capsule, cheap to redraw whenever its colour moves
      shader.load(size: size, scale: scale) { ctx in
        ctx.setFillColor(color.cgColor)
        ctx.addPath(UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.height / 2).cgPath)
        ctx.fillPath()
      }
      shader.view.frame = lensView.bounds
      let drawable = CGSize(width: (rect.width * scale).rounded(), height: (rect.height * scale).rounded())
      if shader.view.drawableSize != drawable { shader.view.drawableSize = drawable }
      var u = shader.uniforms
      u.center = SIMD2(Float(rect.midX * scale), Float(rect.midY * scale))
      u.magnification = Float(magnification)
      u.radius = Float(rect.height / 2 * scale)
      u.bezel = Float(rect.height * 0.25 * scale)
      u.refraction = Float(3 * scale * press)
      u.chroma = 1
      u.press = Float(press)
      shader.uniforms = u
      shader.render()
    } else {
      fallbackTrack.isHidden = false
      fallbackTrack.backgroundColor = color.cgColor
      fallbackTrack.bounds = bounds
      fallbackTrack.cornerRadius = bounds.height / 2
      fallbackTrack.setAffineTransform(CGAffineTransform(scaleX: magnification, y: magnification))
      fallbackTrack.position = CGPoint(
        x: lensView.bounds.midX - (rect.midX - bounds.midX) * magnification,
        y: lensView.bounds.midY - (rect.midY - bounds.midY) * magnification)
    }
  }

  // MARK: - touch

  @objc private func handleTouch(_ r: UILongPressGestureRecognizer) {
    let x = r.location(in: self).x
    let travel = max(1, bounds.width - 2 * inset - restSize.width)
    switch r.state {
    case .began:
      dragging = true
      moved = false
      downX = x
      downPos = springs.value[0]
      springs.target[1] = UIAccessibility.isReduceMotionEnabled ? 0 : 1
      springs.stiffness = 700
      springs.damping = 1
      springs.start()
    case .changed:
      let dx = x - downX
      if abs(dx) > 4 { moved = true }
      if moved {
        springs.target[0] = min(max(downPos + dx / travel, 0), 1)
        springs.start()
      }
    case .ended:
      dragging = false
      // a tap flips, a drag lands on whichever side the thumb is closer to
      let next = moved ? springs.target[0] > 0.5 : !value
      settle(next ? 1 : 0)
      if next != value {
        value = next
        onValueChange(["value": next])
      }
    default:
      dragging = false
      settle(value ? 1 : 0)
    }
  }

  // a scroll view around the switch waits for it
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    other.view is UIScrollView
  }
}
