import ExpoModulesCore
import UIKit

/// iOS 26 style slider. The white thumb turns into a clear lens over the track while it's held and
/// dragged, then settles back into the thumb.
final class GlassSliderView: ExpoView, UIGestureRecognizerDelegate {
  let onValueChange = EventDispatcher()
  let onSlidingComplete = EventDispatcher()

  /// 0..1, JS maps it to the real range
  var value: CGFloat = 0
  var disabled = false
  var fillColor: UIColor?
  var lens = true

  private let track = CAShapeLayer()
  private let fill = CAShapeLayer()
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
  private var downX: CGFloat = 0
  private var downPos: CGFloat = 0
  private var lastSent: CGFloat = -1

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
    thumb.shadowOpacity = 0.18
    thumb.shadowRadius = 4
    thumb.shadowOffset = CGSize(width: 0, height: 2)
    if #available(iOS 13.0, *) {
      thumb.cornerCurve = .continuous
      lensView.layer.cornerCurve = .continuous
    }
    lensView.isUserInteractionEnabled = false
    lensView.clipsToBounds = true
    lensView.isHidden = true
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
    layer.addSublayer(fill)
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
    let target = min(max(value, 0), 1)
    if !placed {
      springs.snap(0, target)
      springs.snap(1, 0)
      placed = true
      applyFrame()
    } else if !dragging {
      springs.target[0] = target
      springs.stiffness = 420
      springs.damping = 1
      springs.start()
    }
  }

  // MARK: - geometry

  private var restSize: CGSize { CGSize(width: 38, height: 24) }
  private var trackHeight: CGFloat { 6 }
  private var travel: CGFloat { max(1, bounds.width - restSize.width) }

  private func thumbRect(pos: CGFloat, press: CGFloat) -> CGRect {
    let rest = restSize
    let lensH = rest.height * 1.5
    let lensW = lensH * 1.6
    let w = rest.width + (lensW - rest.width) * press
    let h = rest.height + (lensH - rest.height) * press
    let cx = rest.width / 2 + travel * pos
    return CGRect(x: cx - w / 2, y: bounds.midY - h / 2, width: w, height: h)
  }

  private var colors: (fill: UIColor, rest: UIColor) {
    let dark = traitCollection.userInterfaceStyle == .dark
    return (
      fillColor ?? UIColor(red: 10 / 255, green: 132 / 255, blue: 1, alpha: 1),
      dark ? UIColor(white: 1, alpha: 0.2) : UIColor(white: 0, alpha: 0.1)
    )
  }

  private func trackRect() -> CGRect {
    CGRect(x: 0, y: bounds.midY - trackHeight / 2, width: bounds.width, height: trackHeight)
  }

  private func applyFrame() {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let pos = springs.value[0]
    let press = lens ? springs.value[1] : 0
    let rect = thumbRect(pos: pos, press: press)
    let radius = rect.height / 2
    let bar = trackRect()
    let fillX = restSize.width / 2 + travel * pos

    CATransaction.begin()
    CATransaction.setDisableActions(true)

    let c = colors
    track.frame = bounds
    track.path = UIBezierPath(roundedRect: bar, cornerRadius: trackHeight / 2).cgPath
    track.fillColor = c.rest.cgColor
    fill.frame = bounds
    fill.path = UIBezierPath(
      roundedRect: CGRect(x: 0, y: bar.minY, width: max(trackHeight, fillX), height: trackHeight),
      cornerRadius: trackHeight / 2
    ).cgPath
    fill.fillColor = c.fill.cgColor

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
      if track.mask == nil {
        track.mask = trackMask
        let fillMask = CAShapeLayer()
        fillMask.fillRule = .evenOdd
        fill.mask = fillMask
      }
      (fill.mask as? CAShapeLayer)?.frame = bounds
      (fill.mask as? CAShapeLayer)?.path = hole.cgPath

      lensView.frame = rect
      lensView.layer.cornerRadius = radius
      lensRim.frame = lensView.bounds
      lensRim.opacity = Float(press)
      lensRimMask.path = UIBezierPath(roundedRect: lensView.bounds.insetBy(dx: 0.75, dy: 0.75), cornerRadius: radius).cgPath
      drawLens(rect: rect, press: press, fillX: fillX)
    } else if track.mask != nil {
      track.mask = nil
      fill.mask = nil
    }

    CATransaction.commit()
  }

  private func drawLens(rect: CGRect, press: CGFloat, fillX: CGFloat) {
    let magnification = 1 + 0.25 * press
    let c = colors
    let bar = trackRect()
    let size = bounds.size
    let paint: (CGContext) -> Void = { ctx in
      ctx.setFillColor(c.rest.cgColor)
      ctx.addPath(UIBezierPath(roundedRect: bar, cornerRadius: bar.height / 2).cgPath)
      ctx.fillPath()
      ctx.setFillColor(c.fill.cgColor)
      ctx.addPath(
        UIBezierPath(
          roundedRect: CGRect(x: 0, y: bar.minY, width: max(bar.height, fillX), height: bar.height),
          cornerRadius: bar.height / 2
        ).cgPath)
      ctx.fillPath()
    }
    if let shader = shader ?? LensShaderRenderer(frame: .zero) {
      if self.shader == nil {
        self.shader = shader
        lensView.insertSubview(shader.view, at: 0)
      }
      fallbackTrack.isHidden = true
      let scale = window?.screen.scale ?? UIScreen.main.scale
      // a flat bar, cheap to redraw whenever the fill moves
      shader.load(size: size, scale: scale, draw: paint)
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
      fallbackTrack.bounds = bounds
      fallbackTrack.contents = UIGraphicsImageRenderer(size: size).image { paint($0.cgContext) }.cgImage
      fallbackTrack.setAffineTransform(CGAffineTransform(scaleX: magnification, y: magnification))
      fallbackTrack.position = CGPoint(
        x: lensView.bounds.midX - (rect.midX - bounds.midX) * magnification,
        y: lensView.bounds.midY - (rect.midY - bounds.midY) * magnification)
    }
  }

  // MARK: - touch

  private func send(_ pos: CGFloat) {
    guard abs(pos - lastSent) > 0.0005 else { return }
    lastSent = pos
    onValueChange(["value": pos])
  }

  @objc private func handleTouch(_ r: UILongPressGestureRecognizer) {
    let x = r.location(in: self).x
    switch r.state {
    case .began:
      dragging = true
      downX = x
      // a touch off the thumb jumps it there first
      let current = springs.value[0]
      let thumbX = restSize.width / 2 + travel * current
      downPos = abs(x - thumbX) <= restSize.width ? current : min(max((x - restSize.width / 2) / travel, 0), 1)
      springs.target[0] = downPos
      springs.target[1] = UIAccessibility.isReduceMotionEnabled ? 0 : 1
      springs.stiffness = 700
      springs.damping = 1
      springs.start()
      send(downPos)
    case .changed:
      let pos = min(max(downPos + (x - downX) / travel, 0), 1)
      springs.target[0] = pos
      springs.start()
      send(pos)
    default:
      dragging = false
      springs.target[1] = 0
      springs.stiffness = 420
      springs.damping = 1
      springs.start()
      onSlidingComplete(["value": springs.target[0]])
    }
  }

  // a scroll view around the slider waits for it
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    other.view is UIScrollView
  }
}
